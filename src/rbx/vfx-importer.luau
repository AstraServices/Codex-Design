-- CodexVFX Studio importer (run once in the Roblox Studio command bar after inserting the package).
-- 1. Insert the exported .rbxm/.rbxmx and move the CodexVFX folder into ReplicatedStorage.
-- 2. Run this script. It reads CodexVFX.Manifest, turns Decal ids into Image ids (InsertService) and writes them into
--    every ParticleEmitter/Beam/Trail/SpecialMesh texture that still has no id. Missing uploads are listed in Output.
local InsertService = game:GetService("InsertService")
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local root = ReplicatedStorage:FindFirstChild("CodexVFX") or workspace:FindFirstChild("CodexVFX", true)
assert(root, "CodexVFX folder not found: put it in ReplicatedStorage first")
local manifest = HttpService:JSONDecode(root:WaitForChild("Manifest").Value)
local module = root:WaitForChild("VFXStudio")
local fixed, missing, resolved = 0, {}, {}

local function imageFromDecal(decalId: number): string?
	if resolved[decalId] then return resolved[decalId] end
	local ok, model = pcall(function() return InsertService:LoadAsset(decalId) end)
	if not ok or not model then return nil end
	local decal = model:FindFirstChildWhichIsA("Decal", true)
	local tex = decal and decal.Texture
	model:Destroy()
	resolved[decalId] = tex
	return tex
end

for _, entry in manifest.textures or {} do
	local target = module
	for part in string.gmatch(entry.path, "[^/]+") do target = target and target:FindFirstChild(part) end
	if not target then
		warn("[CodexVFX] instance not found:", entry.path)
	elseif entry.imageId then
		local id = "rbxassetid://" .. entry.imageId
		if target:IsA("SpecialMesh") then target.TextureId = id else (target :: any).Texture = id end
		fixed += 1
	elseif entry.decalId then
		local tex = imageFromDecal(tonumber(entry.decalId))
		if tex then
			if target:IsA("SpecialMesh") then target.TextureId = tex else (target :: any).Texture = tex end
			fixed += 1
		else
			table.insert(missing, entry.file .. " (decal " .. entry.decalId .. " could not be loaded; check ownership/moderation)")
		end
	else
		table.insert(missing, entry.file)
	end
end

print(("[CodexVFX] %d texture(s) assigned."):format(fixed))
if #missing > 0 then
	warn("[CodexVFX] Upload these files (Asset Manager → Bulk Import or Codex Design → Upload), then run again:")
	for _, f in missing do warn("   ", f) end
end
