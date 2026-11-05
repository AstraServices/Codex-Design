import { luauComment } from '../watermark.js';
// Luau code generator: one self-contained ModuleScript that rebuilds the exact same effect templates at runtime
// (same instances and property values as the .rbxm) and returns the VFXStudio API. The top of the file is a plain
// CONFIG table: texture ids per layer (paste decal or image ids), quality, cull distance. No plugin, no file import:
// paste it into ReplicatedStorage as a ModuleScript, fill CONFIG (or let Codex Design fill it after uploading), require it.
import { buildEffect, safeName } from './vfx-build.js';
import { ENUM, flatten } from './instances.js';

const ENUM_OF = { FlipbookLayout: 'ParticleFlipbookLayout', FlipbookMode: 'ParticleFlipbookMode', Orientation: 'ParticleOrientation', EmissionDirection: 'NormalId', ShapeStyle: 'ParticleEmitterShapeStyle',
  ShapeInOut: 'ParticleEmitterShapeInOut', TextureMode: 'TextureMode', Face: 'NormalId', DepthMode: 'HighlightDepthMode', Material: 'Material', MeshType: 'MeshType' };
const TABLE_OF = { ParticleFlipbookLayout: 'FlipbookLayout', ParticleFlipbookMode: 'FlipbookMode', ParticleOrientation: 'ParticleOrientation', NormalId: 'NormalId', ParticleEmitterShape: 'ParticleEmitterShape',
  ParticleEmitterShapeStyle: 'ParticleEmitterShapeStyle', ParticleEmitterShapeInOut: 'ParticleEmitterShapeInOut', TextureMode: 'TextureMode', HighlightDepthMode: 'HighlightDepthMode', Material: 'Material', MeshType: 'MeshType', PartType: 'PartType' };
// Serialized names → scripting API names.
const API_NAME = { size: 'Size', shape: 'Shape', Color3uint8: 'Color' };
const n = v => { const r = Math.round(v * 1e5) / 1e5; return String(Object.is(r, -0) ? 0 : r); };
const str = s => JSON.stringify(String(s)); // JSON string literals are valid Luau strings

function enumName(enumType, value) { const t = ENUM[TABLE_OF[enumType]]; const name = t && Object.entries(t).find(([, v]) => v === value)?.[0]; if (!name) throw new Error(`No Enum.${enumType} with value ${value}`); return `Enum.${enumType}.${name}`; }

function luauValue(cls, key, { type, value }, texVar) {
  switch (type) {
    case 'string': return str(value);
    case 'content': return texVar ?? str(value);
    case 'bool': return value ? 'true' : 'false';
    case 'int': case 'float': return n(value);
    case 'enum': { const et = key === 'shape' ? 'PartType' : key === 'Shape' && cls === 'ParticleEmitter' ? 'ParticleEmitterShape' : ENUM_OF[key]; if (!et) throw new Error(`${cls}.${key}: unknown enum type`); return enumName(et, value); }
    case 'color3': return `Color3.new(${value.map(n).join(', ')})`;
    case 'color3u8': return `Color3.fromRGB(${value.join(', ')})`;
    case 'vec2': return `Vector2.new(${value.map(n).join(', ')})`;
    case 'vec3': return `Vector3.new(${value.map(n).join(', ')})`;
    case 'cframe': return `CFrame.new(${[...value.p, ...value.r].map(n).join(', ')})`;
    case 'numseq': return `NumberSequence.new({ ${value.map(([t, v, e]) => `NumberSequenceKeypoint.new(${n(t)}, ${n(v)}, ${n(e)})`).join(', ')} })`;
    case 'colseq': return `ColorSequence.new({ ${value.map(([t, c]) => `ColorSequenceKeypoint.new(${n(t)}, Color3.new(${c.map(n).join(', ')}))`).join(', ')} })`;
    case 'numrange': return `NumberRange.new(${n(value[0])}, ${n(value[1])})`;
    default: throw new Error(`Luau generator: unsupported type ${type}`);
  }
}

/** Instance tree → Luau table literal {C=class, N=name, P={…}, R={prop=refName}, K={children}} */
function luauTree(node, layerOfTexture, pad = '\t') {
  const props = [], refs = [];
  for (const [k, v] of Object.entries(node.props)) {
    if (k === 'Name' || v.type === 'source') continue;
    if (v.type === 'ref') { if (v.value) refs.push(`${k} = ${str(v.value.name)}`); continue; }
    const tex = v.type === 'content' && ['Texture', 'TextureId'].includes(k) ? layerOfTexture.get(node) : null;
    props.push(`${API_NAME[k] ?? k} = ${luauValue(node.className, k, v, tex ? `tex(${str(tex)})` : null)}`);
  }
  const kids = node.children.map(c => luauTree(c, layerOfTexture, pad + '\t'));
  return `{ C = ${str(node.className)}, N = ${str(node.name)}, P = { ${props.join(', ')} }${refs.length ? `, R = { ${refs.join(', ')} }` : ''}${kids.length ? `, K = {\n${kids.map(k => pad + '\t' + k).join(',\n')}\n${pad}}` : ''} }`;
}

/** effects: [effect JSON]; ids: {layerKey: '123'} known image/decal ids; controller: vfx-controller.luau source. */
export function generateLuau(effects, { controller, textures = [], quality = 'Auto', cullDistance = 250 } = {}) {
  if (!controller) throw new Error('generateLuau needs the controller source');
  const trees = [], cfg = [];
  for (const fx of effects) {
    const { folder } = buildEffect(fx, { assets: {} }), layerOfTexture = new Map(), fxName = safeName(fx.name);
    // Map each textured instance to its CONFIG key "<Effect>.<Layer>"
    for (const inst of flatten(folder)) if (['ParticleEmitter', 'Beam', 'Trail', 'SpecialMesh'].includes(inst.className)) {
      const layerName = inst.className === 'SpecialMesh' ? inst.parent.name : inst.name, key = `${fxName}.${layerName}`, t = textures.find(x => x.key === key);
      const L = (fx.layers ?? []).find(l => safeName(l.name ?? l.type) === layerName);
      if (!L?.texture) continue; layerOfTexture.set(inst, key);
      const id = L.texture.assetId ?? t?.imageId ?? t?.decalId ?? '';
      cfg.push(`\t\t[${str(key)}] = ${str(id ? `rbxassetid://${String(id).replace(/\D/g, '')}` : '')},${' '.repeat(Math.max(1, 34 - key.length))}-- ${t?.imageId || L.texture.assetId ? 'image id' : t?.decalId ? 'decal id (resolved to its image automatically)' : 'PASTE ID'} · ${L.texture.src ?? 'Roblox asset'}`);
    }
    trees.push(luauTree(folder, layerOfTexture, '\t'));
  }
  const body = controller.replace(/^--!nonstrict\n/, '').replace('local EffectsFolder = script:WaitForChild("Effects")', 'local EffectsFolder = BuildEffects()');
  if (!body.includes('BuildEffects()')) throw new Error('Controller source changed: EffectsFolder line not found');
  return `--!nonstrict
${luauComment()}
-- ${effects.map(e => safeName(e.name)).join(', ')} · generated by Codex Design VFX Studio (Roblox-native, no plugin needed).
-- Use: put this ModuleScript in ReplicatedStorage, fill CONFIG.Textures, then
--   local VFX = require(game.ReplicatedStorage.${effects.length === 1 ? safeName(effects[0].name) : 'CodexVFX'})
--   VFX.Play(${str(safeName(effects[0].name))}, { Position = Vector3.new(0, 5, 0), Scale = 1, Quality = "Auto" })
-- Server → clients: VFX.PlayForAll(name, opts) (require it once on the server and on every client).

local CONFIG = {
	-- Texture per layer. Paste an image id (rbxassetid://123 or just 123). A Decal id also works: it is turned into
	-- its image id on the server (InsertService; the decal must be yours or public) and is shared with clients.
	-- Codex Design's upload button already writes image ids here.
	Textures = {
${cfg.join('\n') || '\t\t-- (this effect uses no custom textures)'}
	},
	Quality = ${str(quality)},         -- "Auto" | "High" | "Medium" | "Low" | 0–1 (scales burst counts and rates)
	CullDistance = ${n(cullDistance)},        -- studs; clients skip effects farther from the camera
	PoolSize = 4,               -- reused clones per effect
}

local InsertService = game:GetService("InsertService")
local RunService = game:GetService("RunService")
local resolved = {}
local function tex(key: string): string
	local v = tostring(CONFIG.Textures[key] or "")
	local id = string.match(v, "%d+")
	if not id then
		if v ~= "" then warn("[CodexVFX] bad texture id for " .. key .. ": " .. v) end
		return ""
	end
	if resolved[id] then return resolved[id] end
	-- A Decal id points to a Decal asset; ParticleEmitter/Beam/Trail need the image behind it. The server resolves it
	-- with InsertService and stores the result as an attribute on this ModuleScript, which replicates to clients.
	local result = script:GetAttribute("tex_" .. id) or ("rbxassetid://" .. id)
	if RunService:IsServer() and not script:GetAttribute("tex_" .. id) then
		local ok, model = pcall(function() return InsertService:LoadAsset(tonumber(id)) end)
		if ok and model then
			local decal = model:FindFirstChildWhichIsA("Decal", true)
			if decal and decal.Texture ~= "" then result = decal.Texture end
			model:Destroy()
		end
		pcall(function() script:SetAttribute("tex_" .. id, result) end)
	end
	resolved[id] = result
	return result
end

-- ===== Effect data (exactly what VFX Studio exported; edit CONFIG above, not this) =====
local EFFECTS = {
${trees.map(t => '\t' + t).join(',\n')}
}

local made = {}
local function create(spec, parent, byName)
	local inst = Instance.new(spec.C)
	inst.Name = spec.N
	for prop, value in spec.P do
		local ok, err = pcall(function() (inst :: any)[prop] = value end)
		if not ok then warn(("[CodexVFX] %s.%s: %s"):format(spec.N, prop, tostring(err))) end
	end
	made[spec] = inst
	byName[spec.N] = byName[spec.N] or inst
	for _, child in spec.K or {} do create(child, inst, byName) end
	inst.Parent = parent
	return inst
end
local function link(spec, byName)
	local inst = made[spec]
	for prop, name in spec.R or {} do (inst :: any)[prop] = byName[name] end
	for _, child in spec.K or {} do link(child, byName) end
end

local function BuildEffects(): Folder
	local folder = script:FindFirstChild("Effects")
	if folder then return folder end
	folder = Instance.new("Folder")
	folder.Name = "Effects"
	for _, spec in EFFECTS do
		local byName = {}
		create(spec, folder, byName)
		link(spec, byName)
	end
	folder.Parent = script
	return folder
end

-- ===== VFXStudio runtime =====
${body.replace('VFX.CullDistance = 250', 'VFX.CullDistance = CONFIG.CullDistance').replace('VFX.PoolSize = 4', 'VFX.PoolSize = CONFIG.PoolSize').replace('Quality = qualityFactor(o.Quality or "Auto")', 'Quality = qualityFactor(o.Quality or CONFIG.Quality)')}`;
}
