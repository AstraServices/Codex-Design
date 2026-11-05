import { xmlComment } from '../watermark.js';
// RBXMX writer: Roblox XML model format (version 4), the format Studio writes for "Save to File… (.rbxmx)".
import { flatten } from './instances.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = v => { if (!Number.isFinite(v)) return '0'; const r = Math.round(v * 1e6) / 1e6; return String(Object.is(r, -0) ? 0 : r); };

function prop(name, { type, value }, refs) {
  const n = esc(name);
  switch (type) {
    case 'string': return `<string name="${n}">${esc(value)}</string>`;
    case 'source': return `<ProtectedString name="${n}"><![CDATA[${String(value).replaceAll(']]>', ']]]]><![CDATA[>')}]]></ProtectedString>`;
    case 'content': return value ? `<Content name="${n}"><url>${esc(value)}</url></Content>` : `<Content name="${n}"><null></null></Content>`;
    case 'bool': return `<bool name="${n}">${value ? 'true' : 'false'}</bool>`;
    case 'int': return `<int name="${n}">${Math.trunc(value)}</int>`;
    case 'float': return `<float name="${n}">${num(value)}</float>`;
    case 'enum': return `<token name="${n}">${value}</token>`;
    case 'color3': return `<Color3 name="${n}"><R>${num(value[0])}</R><G>${num(value[1])}</G><B>${num(value[2])}</B></Color3>`;
    case 'color3u8': return `<Color3uint8 name="${n}">${(((255 << 24) | (value[0] << 16) | (value[1] << 8) | value[2]) >>> 0)}</Color3uint8>`;
    case 'vec2': return `<Vector2 name="${n}"><X>${num(value[0])}</X><Y>${num(value[1])}</Y></Vector2>`;
    case 'vec3': return `<Vector3 name="${n}"><X>${num(value[0])}</X><Y>${num(value[1])}</Y><Z>${num(value[2])}</Z></Vector3>`;
    case 'cframe': { const [x, y, z] = value.p, r = value.r; return `<CoordinateFrame name="${n}"><X>${num(x)}</X><Y>${num(y)}</Y><Z>${num(z)}</Z>${['R00', 'R01', 'R02', 'R10', 'R11', 'R12', 'R20', 'R21', 'R22'].map((k, i) => `<${k}>${num(r[i])}</${k}>`).join('')}</CoordinateFrame>`; }
    case 'ref': return `<Ref name="${n}">${value ? refs.get(value) ?? 'null' : 'null'}</Ref>`;
    case 'numseq': return `<NumberSequence name="${n}">${value.map(k => k.map(num).join(' ')).join(' ')} </NumberSequence>`;
    case 'colseq': return `<ColorSequence name="${n}">${value.map(([t, c]) => [t, ...c, 0].map(num).join(' ')).join(' ')} </ColorSequence>`;
    case 'numrange': return `<NumberRange name="${n}">${num(value[0])} ${num(value[1])} </NumberRange>`;
    default: throw new Error(`RBXMX: unsupported property type ${type} (${name})`);
  }
}

/** roots: one instance or a list → XML string. */
export function toRBXMX(roots) {
  const list = Array.isArray(roots) ? roots : [roots], refs = new Map();
  flatten(list).forEach((n, i) => refs.set(n, `RBX${(i + 1).toString(16).toUpperCase().padStart(8, '0')}`));
  const item = (n, d) => {
    const pad = '\t'.repeat(d);
    const props = Object.entries(n.props).map(([k, v]) => `${pad}\t\t${prop(k, v, refs)}`).join('\n');
    return `${pad}<Item class="${esc(n.className)}" referent="${refs.get(n)}">\n${pad}\t<Properties>\n${props}\n${pad}\t</Properties>\n${n.children.map(c => item(c, d + 1)).join('')}${pad}</Item>\n`;
  };
  return `${xmlComment()}
<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n\t<Meta name="ExplicitAutoJoints">true</Meta>\n${list.map(r => item(r, 1)).join('')}</roblox>\n`;
}
