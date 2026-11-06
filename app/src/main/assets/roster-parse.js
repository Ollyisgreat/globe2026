// Reads the delegate list, scoring categories, judges and flag emoji out of the
// judging site's index.html, so the TV always matches the website.
(function (root) {
  function literal(src) {
    // The site writes arrays with 'single quoted' strings; turn them into JSON.
    var json = src.replace(/'((?:[^'\\]|\\.)*)'/g, function (m, s) {
      return JSON.stringify(s.replace(/\\(.)/g, '$1'));
    }).replace(/,\s*([\]}])/g, '$1');
    return JSON.parse(json);
  }
  function parseRoster(html) {
    var c = html.match(/const candidates=\[([\s\S]*?)\]\.map\(/);
    var f = html.match(/const fields=(\[\[[\s\S]*?\]\]);/);
    var j = html.match(/JUDGES=(\[[^\]]*\])/);
    var e = html.match(/const COUNTRY_EMOJI=(\{[^}]*\});/);
    if (!c || !f || !j) throw new Error('Roster not found in page');
    var list = literal('[' + c[1] + ']').map(function (x) {
      return { id: x[0], country: x[1], name: x[2], photo: x[3] };
    });
    return { candidates: list, fields: literal(f[1]), judges: literal(j[1]), emoji: e ? literal(e[1]) : {} };
  }
  if (typeof module !== 'undefined') module.exports = { parseRoster: parseRoster };
  else root.parseRoster = parseRoster;
})(this);
