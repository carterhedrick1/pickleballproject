// Shared look for the generated documentation pages, so the three of them read as one set.
//
// The palette is pulled toward the app's own identity: the green from the In or Out logo, and
// neutrals biased very slightly green rather than dead grey. Light and dark are both defined at
// token level; components only ever reference the tokens.

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LIGHT = `
 --ground:#F7FAF6;--surface:#FFFFFF;--surface-2:#EFF4ED;--ink:#18201C;--ink-2:#4B564F;--ink-3:#7E8C85;
 --rule:#DBE3DA;--rule-strong:#C2CDC0;--in:#35853F;--in-soft:#E4F0E2;--out:#6F7D77;--out-soft:#E8ECEA;
 --sms:#9C6516;--sms-soft:#F6ECD9;--alert:#A8401F;--alert-soft:#F7E6E0;`;

const DARK = `
 --ground:#101512;--surface:#171E1A;--surface-2:#1E2622;--ink:#E8EFE9;--ink-2:#AFBCB4;--ink-3:#7E8C85;
 --rule:#2A342E;--rule-strong:#3B473F;--in:#74C47E;--in-soft:#1D2E20;--out:#93A19A;--out-soft:#232B27;
 --sms:#D9A860;--sms-soft:#2C2418;--alert:#E0937B;--alert-soft:#2E1C15;`;

// Fonts are system stacks on purpose: the artifact host blocks external font requests, and a
// silent fallback would be worse than choosing the fallback deliberately.
const baseCss = `
:root{${LIGHT}
 --sans:"Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;
 --serif:Charter,"Bitstream Charter","Iowan Old Style",Georgia,serif;
 --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;}
@media (prefers-color-scheme:dark){:root{${DARK}}}
:root[data-theme="dark"]{${DARK}}
:root[data-theme="light"]{${LIGHT}}

body{background:var(--ground);color:var(--ink);font-family:var(--serif);line-height:1.55;
 -webkit-font-smoothing:antialiased;}
.wrap{max-width:1020px;margin:0 auto;padding:3.5rem 1.5rem 6rem;display:flex;flex-direction:column;gap:3.5rem;}
h1,h2,h3,h4,.eyebrow,.pill,.ref,.kbd{font-family:var(--sans);}
h1{font-size:clamp(1.9rem,4.5vw,2.7rem);line-height:1.05;letter-spacing:-.025em;font-weight:700;
 margin:0;text-wrap:balance;}
h2{font-size:1.35rem;letter-spacing:-.015em;font-weight:700;margin:0;}
h3{font-size:.95rem;font-weight:700;margin:0;letter-spacing:-.005em;}
p{margin:0;}
a{color:var(--in);text-underline-offset:2px;}
a:focus-visible{outline:2px solid var(--in);outline-offset:2px;}
code,.path{font-family:var(--mono);font-size:.82em;}
.path{color:var(--ink-3);word-break:break-all;}
.eyebrow{font-size:.7rem;text-transform:uppercase;letter-spacing:.14em;font-weight:700;color:var(--ink-3);}
.lede{font-size:1.1rem;color:var(--ink-2);max-width:62ch;}

header.top{display:flex;flex-direction:column;gap:1.1rem;padding-bottom:2rem;border-bottom:2px solid var(--ink);}
.how{background:var(--surface);border:1px solid var(--rule);border-left:4px solid var(--in);
 padding:1rem 1.15rem;margin-top:.6rem;}
.how p{font-size:.94rem;color:var(--ink-2);max-width:62ch;}
.how code{background:var(--in-soft);color:var(--in);padding:.1rem .35rem;border-radius:2px;font-weight:700;}

.index{display:flex;flex-direction:column;border:1px solid var(--rule);background:var(--surface);}
.index a{display:grid;gap:1rem;align-items:baseline;padding:.7rem 1rem;border-bottom:1px solid var(--rule);
 text-decoration:none;color:inherit;}
.index a:last-child{border-bottom:0;}
.index a:hover{background:var(--surface-2);}
.index a:focus-visible{outline:2px solid var(--in);outline-offset:-2px;}

.pill{font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.09em;
 padding:.16rem .42rem;border-radius:2px;}
.p-who{background:var(--in-soft);color:var(--in);}
.p-lane{background:var(--out-soft);color:var(--out);}
.ref{font-family:var(--mono);font-size:.78rem;font-weight:700;color:var(--in);
 font-variant-numeric:tabular-nums;white-space:nowrap;}
.kbd{font-family:var(--mono);font-size:.8rem;font-weight:700;background:var(--sms-soft);color:var(--sms);
 padding:.1rem .45rem;border-radius:2px;}

.notes{display:flex;flex-direction:column;gap:.9rem;}
.note{padding:.9rem 1rem;background:var(--surface);border:1px solid var(--rule);
 border-left:4px solid var(--rule-strong);}
.note.warn{border-left-color:var(--alert);}
.note h3{margin-bottom:.25rem;}
.note p{font-size:.9rem;color:var(--ink-2);max-width:70ch;}
.note+.note{margin-top:0;}
`;

/** Wraps generated body HTML in a complete standalone page. */
function page({ title, css = '', body, script = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${baseCss}${css}</style>
</head>
<body>
${body}
${script ? `<script>\n${script}\n</script>` : ''}
</body>
</html>
`;
}

/** Timestamp line for the foot of a generated page. */
function generatedNote(extra = '') {
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `Generated ${when} UTC by the scripts in <span class="path">scripts/</span>. ` +
    `Re-run to refresh.${extra ? ' ' + extra : ''}`;
}

module.exports = { page, escapeHtml, generatedNote, baseCss };
