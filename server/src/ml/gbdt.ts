// Histogram-based gradient-boosted regression trees (squared loss), no dependencies.
// Small and deterministic (seeded), and serializable to JSON for the model registry.

export interface GbdtParams {
  nTrees: number;
  learningRate: number;
  maxDepth: number;
  minLeaf: number;
  lambda: number;
  subsample: number;
  colsample: number;
  maxBins: number;
  seed: number;
}

export const DEFAULT_PARAMS: GbdtParams = {
  nTrees: 250,
  learningRate: 0.04,
  maxDepth: 4,
  minLeaf: 300,
  lambda: 5,
  subsample: 0.5,
  colsample: 0.8,
  maxBins: 48,
  seed: 42,
};

/** Flattened tree: internal nodes have feature >= 0; leaves have feature = -1 and a value. */
export interface Tree {
  feature: number[];
  threshold: number[];
  left: number[];
  right: number[];
  value: number[];
}

export interface GbdtModel {
  base: number;
  learningRate: number;
  trees: Tree[];
  nFeatures: number;
  /** total split gain per feature, for explanations */
  importance: number[];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quantile bin edges per feature (upper edges; value <= edge[b] falls in bin b). */
function binEdges(X: Float64Array[], nF: number, maxBins: number, rand: () => number): Float64Array[] {
  const sampleN = Math.min(X.length, 20000);
  const edges: Float64Array[] = [];
  for (let f = 0; f < nF; f++) {
    const vals: number[] = [];
    for (let k = 0; k < sampleN; k++) vals.push(X[Math.floor(rand() * X.length)][f]);
    vals.sort((a, b) => a - b);
    const uniq: number[] = [];
    for (let b = 1; b < maxBins; b++) {
      const v = vals[Math.floor((b / maxBins) * (vals.length - 1))];
      if (!uniq.length || v > uniq[uniq.length - 1]) uniq.push(v);
    }
    edges.push(Float64Array.from(uniq));
  }
  return edges;
}

function toBin(v: number, e: Float64Array): number {
  let lo = 0;
  let hi = e.length; // bin e.length = above last edge
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v <= e[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function predictTree(t: Tree, x: ArrayLike<number>): number {
  let node = 0;
  while (t.feature[node] >= 0) node = x[t.feature[node]] <= t.threshold[node] ? t.left[node] : t.right[node];
  return t.value[node];
}

/**
 * Per-feature contributions to a prediction (Saabas path attribution): each
 * split on the path credits its feature with the change in node value.
 * base + sum(perFeature) === predict(m, x).
 */
export function explain(m: GbdtModel, x: ArrayLike<number>): { base: number; perFeature: number[] } {
  const perFeature = new Array<number>(m.nFeatures).fill(0);
  let base = m.base;
  for (const t of m.trees) {
    let node = 0;
    base += m.learningRate * t.value[0];
    while (t.feature[node] >= 0) {
      const f = t.feature[node];
      const next = x[f] <= t.threshold[node] ? t.left[node] : t.right[node];
      perFeature[f] += m.learningRate * (t.value[next] - t.value[node]);
      node = next;
    }
  }
  return { base, perFeature };
}

export function predict(m: GbdtModel, x: ArrayLike<number>): number {
  let s = m.base;
  for (const t of m.trees) s += m.learningRate * predictTree(t, x);
  return s;
}

/**
 * Fit. `onTree` is awaited after each tree so long trainings can yield to the
 * event loop (and report progress) instead of blocking the server.
 */
export async function fit(
  X: Float64Array[],
  y: Float64Array,
  params: Partial<GbdtParams> = {},
  onTree?: (i: number) => Promise<void> | void,
): Promise<GbdtModel> {
  const p = { ...DEFAULT_PARAMS, ...params };
  const n = X.length;
  const nF = X[0].length;
  const rand = rng(p.seed);
  const edges = binEdges(X, nF, p.maxBins, rand);
  const nBins = edges.map((e) => e.length + 1);
  const maxB = Math.max(...nBins);

  const binned = new Uint8Array(n * nF);
  for (let i = 0; i < n; i++) for (let f = 0; f < nF; f++) binned[i * nF + f] = toBin(X[i][f], edges[f]);

  let base = 0;
  for (let i = 0; i < n; i++) base += y[i];
  base /= n;
  const pred = new Float64Array(n).fill(base);
  const grad = new Float64Array(n);
  const trees: Tree[] = [];
  const importance = new Array<number>(nF).fill(0);
  const histG = new Float64Array(nF * maxB);
  const histN = new Float64Array(nF * maxB);

  for (let ti = 0; ti < p.nTrees; ti++) {
    for (let i = 0; i < n; i++) grad[i] = y[i] - pred[i]; // negative gradient of squared loss
    const rows: number[] = [];
    for (let i = 0; i < n; i++) if (rand() < p.subsample) rows.push(i);
    const feats: number[] = [];
    for (let f = 0; f < nF; f++) if (rand() < p.colsample) feats.push(f);
    if (!feats.length) feats.push(Math.floor(rand() * nF));

    const tree: Tree = { feature: [], threshold: [], left: [], right: [], value: [] };
    const newNode = () => {
      tree.feature.push(-1);
      tree.threshold.push(0);
      tree.left.push(-1);
      tree.right.push(-1);
      tree.value.push(0);
      return tree.feature.length - 1;
    };

    // iterative depth-wise growth
    const stack: { node: number; idx: number[]; depth: number }[] = [{ node: newNode(), idx: rows, depth: 0 }];
    while (stack.length) {
      const { node, idx, depth } = stack.pop()!;
      let G = 0;
      for (const i of idx) G += grad[i];
      const N = idx.length;
      tree.value[node] = G / (N + p.lambda);
      if (depth >= p.maxDepth || N < 2 * p.minLeaf) continue;

      histG.fill(0);
      histN.fill(0);
      for (const i of idx) {
        const g = grad[i];
        const off = i * nF;
        for (const f of feats) {
          const k = f * maxB + binned[off + f];
          histG[k] += g;
          histN[k] += 1;
        }
      }
      const parentScore = (G * G) / (N + p.lambda);
      let best = { gain: 1e-9, f: -1, b: -1 };
      for (const f of feats) {
        let gl = 0;
        let nl = 0;
        for (let b = 0; b < nBins[f] - 1; b++) {
          gl += histG[f * maxB + b];
          nl += histN[f * maxB + b];
          const nr = N - nl;
          if (nl < p.minLeaf || nr < p.minLeaf) continue;
          const gr = G - gl;
          const gain = (gl * gl) / (nl + p.lambda) + (gr * gr) / (nr + p.lambda) - parentScore;
          if (gain > best.gain) best = { gain, f, b };
        }
      }
      if (best.f < 0) continue;
      importance[best.f] += best.gain;
      const L: number[] = [];
      const R: number[] = [];
      for (const i of idx) (binned[i * nF + best.f] <= best.b ? L : R).push(i);
      tree.feature[node] = best.f;
      tree.threshold[node] = edges[best.f][best.b];
      const l = newNode();
      const r = newNode();
      tree.left[node] = l;
      tree.right[node] = r;
      stack.push({ node: l, idx: L, depth: depth + 1 }, { node: r, idx: R, depth: depth + 1 });
    }

    for (let i = 0; i < n; i++) pred[i] += p.learningRate * predictTree(tree, X[i]);
    trees.push(tree);
    if (onTree) await onTree(ti);
  }
  return { base, learningRate: p.learningRate, trees, nFeatures: nF, importance };
}
