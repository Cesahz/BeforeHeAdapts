"""test_shared.py - los modulos de raiz que no pertenecen a ningun dominio.

`text_utils` (ADR 004) y `enforcement` (ADR 005) se extrajeron de
`security/` cuando aparecio un segundo dominio que los necesitaba. estos tests
verifican dos cosas distintas:

1. que la extraccion no cambio el comportamiento
2. que lo extraido es **de verdad** generico, probandolo con una escalera de
   accion inventada que no se parece a la de http
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

import pytest

from kavach.enforcement import Governor, GovernorConfig, Ladder, Mode
from kavach.text_utils import ENTROPY_BUCKETS, entropy_bucket, shannon_entropy


#============================================================================
#text_utils
#============================================================================


class TestEntropia:
    def test_el_texto_vacio_no_rompe(self):
        assert shannon_entropy("") == 0.0
        assert entropy_bucket("") == "low"

    def test_un_solo_caracter_repetido_tiene_entropia_cero(self):
        assert shannon_entropy("aaaaaaaa") == 0.0

    def test_mas_variedad_es_mas_entropia(self):
        assert shannon_entropy("aaaabbbb") < shannon_entropy("abcdefgh")

    def test_los_tramos_son_monotonos(self):
        assert shannon_entropy("aaaa") <= shannon_entropy("abcdefghijklmnop")
        assert entropy_bucket("aaaaaaaaaaaa") == "low"
        assert entropy_bucket("abcdefghijklmnopqrstuvwxyz0123456789+/=") == "extreme"

    def test_todo_tramo_sale_del_vocabulario_declarado(self):
        muestras = ["", "a", "hola mundo", "aGVsbG8gd29ybGQ=", "x" * 500, "!@#$%^&*()"]
        assert all(entropy_bucket(m) in ENTROPY_BUCKETS for m in muestras)

    def test_es_determinista(self):
        texto = "un texto cualquiera para medir dos veces"
        assert shannon_entropy(texto) == shannon_entropy(texto)

    def test_los_dos_dominios_ven_la_misma_medida(self):
        """el punto del ADR 004: una sola definicion, no dos que divergen."""
        from kavach.llmsec.features import entropy_bucket as llm_bucket
        from kavach.security.features import entropy_bucket as http_bucket

        for muestra in ("hola", "aGVsbG8gd29ybGQgZXN0byBlcyBiYXNlNjQ=", "aaaa"):
            assert http_bucket(muestra) == llm_bucket(muestra) == entropy_bucket(muestra)


#============================================================================
#enforcement: la prueba de que es generico de verdad
#============================================================================


class FakeAction(IntEnum):
    """una escalera inventada, sin nada que ver con http ni con llm.

    si el gobernador funciona con esto, es generico. si necesitara saber que
    existe `THROTTLE`, no lo seria.
    """

    PASS = 0
    NOTE = 1
    SLOW = 2
    STOP = 3

    @property
    def is_disruptive(self) -> bool:
        return self >= FakeAction.SLOW


FAKE_LADDER = Ladder(allow=FakeAction.PASS, degraded=FakeAction.SLOW, monitor=FakeAction.NOTE)


@dataclass(frozen=True)
class FakeCountermeasure:
    action: FakeAction
    cluster_id: str = "c"
    reason: str = "prueba"
    ttl_ms: float = 60_000.0
    issued_at_ms: float = 0.0

    def active_at(self, timestamp_ms: float) -> bool:
        return timestamp_ms < self.issued_at_ms + self.ttl_ms

    def to_dict(self) -> dict:
        return {"action": self.action.name, "cluster_id": self.cluster_id}


def cm(action: FakeAction = FakeAction.STOP) -> FakeCountermeasure:
    return FakeCountermeasure(action=action)


class TestGobernadorGenerico:
    def test_funciona_con_una_escalera_ajena(self):
        g = Governor(FAKE_LADDER, mode=Mode.ENFORCING)
        d = g.decide(cm(), target="/x", source="s", timestamp_ms=0.0)
        assert d.applied is FakeAction.STOP

    def test_modo_sombra_usa_la_accion_neutra_del_dominio(self):
        g = Governor(FAKE_LADDER, mode=Mode.SHADOW)
        d = g.decide(cm(), target="/x", source="s", timestamp_ms=0.0)
        assert d.applied is FAKE_LADDER.allow
        assert d.proposed is FakeAction.STOP
        assert d.suppressed

    def test_el_kill_switch_no_apaga_la_observacion(self):
        g = Governor(FAKE_LADDER, mode=Mode.ENFORCING)
        g.kill()
        d = g.decide(cm(), target="/x", source="s", timestamp_ms=0.0)
        assert d.applied is FAKE_LADDER.allow
        assert d.killed
        assert d.proposed is FakeAction.STOP

    def test_el_freno_degrada_a_la_accion_que_el_dominio_eligio(self):
        cfg = GovernorConfig(max_disruptive_fraction=0.2, brake_window=50, brake_warmup=10)
        g = Governor(FAKE_LADDER, cfg, mode=Mode.ENFORCING)
        aplicadas = [
            g.decide(cm(), target="/x", source="s", timestamp_ms=float(i)).applied
            for i in range(200)
        ]
        assert FakeAction.STOP in aplicadas
        assert FAKE_LADDER.degraded in aplicadas
        assert g.disruptive_fraction <= cfg.max_disruptive_fraction + 0.02

    def test_las_exenciones_se_declaran_por_objetivo_no_por_ruta(self):
        cfg = GovernorConfig(exempt_targets=("interno/",))
        g = Governor(FAKE_LADDER, cfg, mode=Mode.ENFORCING)
        assert g.decide(cm(), target="interno/salud", source="s", timestamp_ms=0.0).exempt
        assert not g.decide(cm(), target="publico/x", source="s", timestamp_ms=0.0).exempt

    def test_la_histeresis_sigue_evitando_el_titileo(self):
        cfg = GovernorConfig(max_disruptive_fraction=0.2, brake_window=50, brake_warmup=10)
        g = Governor(FAKE_LADDER, cfg, mode=Mode.ENFORCING)
        estados = []
        for i in range(300):
            g.decide(cm(), target="/x", source="s", timestamp_ms=float(i))
            estados.append(g.brake_engaged)
        cambios = sum(1 for a, b in zip(estados, estados[1:]) if a != b)
        assert cambios < 12

    def test_el_snapshot_no_depende_del_dominio(self):
        g = Governor(FAKE_LADDER, mode=Mode.ENFORCING)
        g.decide(cm(), target="/x", source="s", timestamp_ms=0.0)
        snapshot = g.snapshot(1000.0)
        assert set(snapshot) >= {"mode", "kill_switch", "brake_engaged", "active_countermeasures"}

    def test_las_contramedidas_vencidas_se_purgan(self):
        g = Governor(FAKE_LADDER, mode=Mode.ENFORCING)
        g.decide(cm(), target="/x", source="s", timestamp_ms=0.0)
        assert len(g.active_countermeasures(1000.0)) == 1
        assert len(g.active_countermeasures(10**9)) == 0

    def test_no_registra_lo_que_no_supera_el_umbral_de_monitoreo(self):
        g = Governor(FAKE_LADDER, mode=Mode.ENFORCING)
        g.decide(cm(FakeAction.NOTE), target="/x", source="s", timestamp_ms=0.0)
        assert g.active_countermeasures(1.0) == []


class TestCompatibilidadDelDominioHttp:
    """la extraccion no debia cambiar nada de lo que ya funcionaba."""

    def test_la_api_publica_de_security_sigue_igual(self):
        from kavach.security import Governor as HttpGovernor, GovernorConfig as HttpConfig, Mode as HttpMode

        g = HttpGovernor(HttpConfig(), mode=HttpMode.ENFORCING)
        assert g.ladder.allow.name == "ALLOW"
        assert g.ladder.degraded.name == "THROTTLE"

    def test_el_parametro_sigue_llamandose_path(self):
        from kavach.security import Governor as HttpGovernor, Mode as HttpMode
        from kavach.security.countermeasures import Action, Countermeasure

        g = HttpGovernor(mode=HttpMode.ENFORCING)
        medida = Countermeasure(
            action=Action.QUARANTINE, cluster_id="c", weakness="w", threat_score=0.9,
            ttl_ms=1000.0, issued_at_ms=0.0, reason="x",
        )
        assert g.decide(medida, path="/health", source="s", timestamp_ms=0.0).exempt

    def test_el_alias_de_exenciones_del_dominio_sigue_disponible(self):
        from kavach.security import GovernorConfig as HttpConfig

        config = HttpConfig()
        assert config.exempt_paths == config.exempt_targets
        assert "/health" in config.exempt_paths
