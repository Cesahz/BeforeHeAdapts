// signature/ — forma canónica del estímulo y geometría del espacio de firmas.
//
// Este módulo es puro: sin I/O, sin tiempo, sin aleatoriedad. Es la base sobre
// la que se apoyan ledger/, policy/ y engine/.
//
// Identidad de cluster y forma de N(c): ver ADR 0002.

/** Dimensión atómica de un estímulo, tal como la emite el puerto `StimulusTranslator`. */
export type Primitive = string;

/** Identidad de un cluster de adaptación. Función pura de la firma (ADR 0002). */
export type ClusterId = string;

/**
 * Forma canónica de un estímulo. Se construye siempre vía `canonicalize`:
 * las primitivas quedan deduplicadas y ordenadas, de modo que composiciones
 * equivalentes producen firmas idénticas sin importar el orden de construcción.
 */
export interface StimulusSignature {
  readonly primitives: readonly Primitive[];
  readonly intensity: number;
}

/** Separador de la clave canónica. No puede aparecer dentro de una primitiva. */
const CLUSTER_SEPARATOR = "|";

/**
 * Construye la forma canónica de una firma: primitivas deduplicadas y ordenadas.
 *
 * @throws si no hay primitivas, si alguna está vacía o contiene el separador, o
 * si la intensidad no es un número finito positivo. Una firma inválida es un
 * error del adaptador de dominio, no algo que el núcleo deba tolerar en silencio.
 */
export function canonicalize(
  primitives: readonly Primitive[],
  intensity: number,
): StimulusSignature {
  if (primitives.length === 0) {
    throw new Error("firma inválida: se requiere al menos una primitiva");
  }
  for (const p of primitives) {
    if (p.length === 0) {
      throw new Error("firma inválida: primitiva vacía");
    }
    if (p.includes(CLUSTER_SEPARATOR)) {
      throw new Error(
        `firma inválida: la primitiva "${p}" contiene el separador ${CLUSTER_SEPARATOR}`,
      );
    }
  }
  if (!Number.isFinite(intensity) || intensity <= 0) {
    throw new Error("firma inválida: la intensidad debe ser un número finito positivo");
  }
  const unique = [...new Set(primitives)].sort();
  return { primitives: unique, intensity };
}

/**
 * Clave canónica del cluster al que pertenece la firma (ADR 0002).
 *
 * Es una función pura de la firma: no depende del estado ni del orden histórico
 * de llegada, por lo que el replay de cualquier log produce siempre los mismos
 * clusters. La similitud NO funde clusters; solo transfiere resistencia (R6).
 */
export function clusterKeyOf(signature: StimulusSignature): ClusterId {
  return signature.primitives.join(CLUSTER_SEPARATOR);
}

/**
 * Complejidad `c` de la firma: cantidad de dimensiones activas.
 *
 * El contrato define `c` como dimensiones activas + distancia de novedad
 * respecto a clusters conocidos. La componente de novedad depende del estado y
 * entra en `engine/`; acá vive la parte que solo depende de la firma.
 */
export function complexityOf(signature: StimulusSignature): number {
  return signature.primitives.length;
}

/**
 * `N(c)`: exposiciones procesadas necesarias para completar la adaptación (R2).
 *
 * Lineal en la complejidad (ADR 0002): monótona creciente por construcción, y
 * `N = 1` para la firma de complejidad mínima.
 */
export function requiredExposures(signature: StimulusSignature): number {
  return complexityOf(signature);
}

/**
 * `sim(a, b) ∈ [0, 1]`: similitud entre firmas (índice de Jaccard sobre las
 * primitivas). 1 = mismas primitivas; 0 = ninguna en común.
 *
 * Deliberadamente ignora la intensidad: la intensidad modula la magnitud del
 * estímulo, no qué *tipo* de estímulo es, y R6 transfiere resistencia entre
 * tipos parecidos.
 */
export function sim(a: StimulusSignature, b: StimulusSignature): number {
  const setA = new Set(a.primitives);
  const setB = new Set(b.primitives);
  let intersection = 0;
  for (const p of setA) {
    if (setB.has(p)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Geometría del espacio de firmas. Se expone como objeto para que `policy/` y
 * `engine/` dependan de esta forma y no de las funciones sueltas: más adelante
 * una política podrá inyectar su propia métrica sin tocar el motor.
 */
export interface SignatureSpace {
  readonly sim: (a: StimulusSignature, b: StimulusSignature) => number;
  readonly clusterKeyOf: (signature: StimulusSignature) => ClusterId;
  readonly requiredExposures: (signature: StimulusSignature) => number;
}

/** Espacio de firmas por defecto: Jaccard + clave canónica + `N` lineal. */
export const defaultSignatureSpace: SignatureSpace = {
  sim,
  clusterKeyOf,
  requiredExposures,
};
