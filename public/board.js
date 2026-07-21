'use strict';

/* Point layout, percentage coordinates within a square board. */
const POINT_COORDS = [
  [10, 10], [50, 10], [90, 10],
  [10, 50], [50, 50], [90, 50],
  [10, 90], [50, 90], [90, 90],
];

/* Undirected edges to draw as alpona lines (rows, columns, diagonals). */
const BOARD_EDGES = [
  [0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8], // rows
  [0, 3], [3, 6], [1, 4], [4, 7], [2, 5], [5, 8], // columns
  [0, 4], [4, 8], [2, 4], [4, 6],                  // diagonals
];

/* Adjacency used only for client-side "highlight legal destinations" UX.
   The server is the sole source of truth for legality. */
const ADJACENCY = {
  0: [1, 3, 4], 1: [0, 2, 4], 2: [1, 4, 5],
  3: [0, 4, 6], 4: [0, 1, 2, 3, 5, 6, 7, 8], 5: [2, 4, 8],
  6: [3, 4, 7], 7: [4, 6, 8], 8: [5, 7, 4],
};

function buildLinesSVG() {
  const segs = BOARD_EDGES.map(([a, b]) => {
    const [x1, y1] = POINT_COORDS[a];
    const [x2, y2] = POINT_COORDS[b];
    return `<line class="line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  }).join('');
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${segs}</svg>`;
}

/* Turmeric bead: a sun - filled circle with radiating rays. Shape reads
   distinctly from the indigo diamond even in grayscale. */
function turmericBeadSVG() {
  return `<svg class="bead-shape" viewBox="0 0 40 40" aria-hidden="true">
    <g stroke="#3a2a10" stroke-width="1.5" stroke-linecap="round">
      ${Array.from({ length: 8 }, (_, i) => {
        const angle = (i * Math.PI) / 4;
        const x1 = 20 + Math.cos(angle) * 13, y1 = 20 + Math.sin(angle) * 13;
        const x2 = 20 + Math.cos(angle) * 18, y2 = 20 + Math.sin(angle) * 18;
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`;
      }).join('')}
    </g>
    <circle cx="20" cy="20" r="11" fill="#d6912e" stroke="#3a2a10" stroke-width="1.5" />
  </svg>`;
}

/* Indigo bead: a diamond with a small dot lattice inside (lotus-adjacent
   motif), unmistakably different silhouette from the sun above. */
function indigoBeadSVG() {
  return `<svg class="bead-shape" viewBox="0 0 40 40" aria-hidden="true">
    <polygon points="20,4 36,20 20,36 4,20" fill="#2e3f6e" stroke="#12192c" stroke-width="1.5" />
    <g fill="#c7d0e8">
      <circle cx="20" cy="14" r="1.6" /><circle cx="20" cy="26" r="1.6" />
      <circle cx="14" cy="20" r="1.6" /><circle cx="26" cy="20" r="1.6" />
      <circle cx="20" cy="20" r="1.8" />
    </g>
  </svg>`;
}
