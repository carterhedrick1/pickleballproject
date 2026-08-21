// The small DOM jobs the management page does over and over.
//
// Most of the page already builds its nodes properly - render.js next door creates the roster
// and recipient rows with createElement and textContent - so this is deliberately short. It
// exists for the two habits that were left: clearing a container with `innerHTML = ''`, and
// the three counters that rebuilt a fixed piece of markup with `innerHTML` and a template
// literal just to change a number inside it.

/** Empties a container without handing its contents to the HTML parser on the way out. */
export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Creates an element, optionally with a class and some text.
 * Text always goes in as text - there is no markup path through here.
 */
function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '' && text != null) node.textContent = String(text);
  return node;
}

/**
 * The roster counters: "3/8 players", "2 people waiting", "1 person can't make it".
 *
 * Each was an `innerHTML` assignment that rebuilt two spans and their ids from a template
 * literal on every roster refresh. The ids matter - other code and the browser smoke read
 * them - so they are still there, set as text on real elements.
 *
 * @param {HTMLElement} node - the counter container
 * @param {Array<{id?: string, text: string}>} parts - spans and plain text, in order
 */
export function setCounter(node, parts) {
  if (!node) return node;
  clear(node);
  for (const part of parts) {
    if (part.id) {
      const span = element('span', '', part.text);
      span.id = part.id;
      node.appendChild(span);
    } else {
      node.appendChild(document.createTextNode(part.text));
    }
  }
  return node;
}

/**
 * The "No players yet" line each empty roster column shows.
 *
 * The inline styles are the ones the markup string carried, set as properties rather than
 * parsed out of HTML. Keeping them inline rather than moving them to a class is deliberate:
 * this refactor is not supposed to change a single pixel, and a new class would need new CSS.
 */
export function emptyNote(text) {
  const note = element('p', '', text);
  note.style.textAlign = 'center';
  note.style.color = 'var(--text-muted)';
  note.style.fontStyle = 'italic';
  return note;
}
