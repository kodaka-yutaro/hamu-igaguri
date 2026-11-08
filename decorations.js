// Decorations are an independent visual layer. An anchor cell can hold one
// decoration, while the images themselves may overlap in placement order.
(() => {
  const KEYS = 'abcdefghijklmn';
  const SIZES = [1, 3, 5];
  const ROWS = 16;

  function normalize(rows, decorations) {
    const width = Array.isArray(rows) && rows[0] ? rows[0].length : 0;
    if (!Array.isArray(decorations)) return [];
    const result = [];
    for (const d of decorations) {
      if (!d || !KEYS.includes(d.key) || typeof d.key !== 'string' || d.key.length !== 1 ||
          !Number.isInteger(d.x) || d.x < 0 || d.x >= width ||
          !Number.isInteger(d.y) || d.y < 0 || d.y >= ROWS || !SIZES.includes(d.size)) continue;
      const previous = result.findIndex(item => item.x === d.x && item.y === d.y);
      if (previous !== -1) result.splice(previous, 1);
      result.push({x: d.x, y: d.y, key: d.key, size: d.size});
    }
    return result;
  }

  function fromCourse(course) {
    const rows = course.rows.slice();
    const oldDecorations = [];
    for (let y = 0; y < rows.length; y++) {
      const cells = rows[y].split('');
      for (let x = 0; x < cells.length; x++) {
        if (KEYS.includes(cells[x])) {
          oldDecorations.push({x, y, key: cells[x], size: 1});
          cells[x] = '.';
        }
      }
      rows[y] = cells.join('');
    }
    // New-format entries are later than legacy entries at the same anchor.
    return {rows, decorations: normalize(rows, [...oldDecorations, ...(course.decorations || [])])};
  }

  function place(rows, decorations, x, y, key, size) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= rows[0].length || y < 0 || y >= ROWS) return decorations;
    const previous = decorations.find(d => d.x === x && d.y === y);
    if (key === '.' && !previous) return decorations;
    if (key !== '.' && previous && previous.key === key && previous.size === size) return decorations;
    const next = decorations.filter(d => d.x !== x || d.y !== y);
    if (key !== '.') next.push({x, y, key, size});
    return normalize(rows, next);
  }

  // The editor inserts/removes columns immediately before the last four.
  function resized(rows, decorations, oldWidth, newWidth) {
    const delta = newWidth - oldWidth, cut = oldWidth - 4;
    return normalize(rows, decorations.flatMap(d => {
      if (delta < 0 && d.x >= cut + delta && d.x < cut) return [];
      return [{...d, x: d.x >= cut ? d.x + delta : d.x}];
    }));
  }

  const api = {KEYS, SIZES, normalize, fromCourse, place, resized};
  if (typeof window !== 'undefined') window.HamuDecorations = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
