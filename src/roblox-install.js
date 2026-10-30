// Kept as a separate source so the Studio-side install can be reviewed independently.
export const installAnimations = `-- Select imported rig Model and inserted AnimSaves Folder; run in Studio Command Bar.
local selection=game:GetService("Selection"):Get()
local rig,saves
for _,v in ipairs(selection) do
  if v:IsA("Model") then assert(not rig,"Select one rig");rig=v
  elseif v:IsA("Folder") and v.Name=="AnimSaves" then saves=v end
end
assert(rig and saves,"Select the rig Model and inserted AnimSaves Folder together")
assert(not rig:FindFirstChild("AnimSaves"),"Rig already has AnimSaves; merge or rename it first")
local roots={}
for _,b in ipairs(rig:GetDescendants()) do
  if b:IsA("Bone") and not b.Parent:IsA("Bone") then table.insert(roots,b) end
end
assert(#roots>0,"Selected rig has no imported Bones")
-- Adapt to the actual primitive/MeshPart hierarchy produced by Studio.
local prepared={}
for _,seq in ipairs(saves:GetChildren()) do
  assert(seq:IsA("KeyframeSequence"),"Expected KeyframeSequence")
  local copy=seq:Clone()
  for _,frame in ipairs(copy:GetKeyframes()) do
    local sources={}
    for _,p in ipairs(frame:GetDescendants()) do if p:IsA("Pose") then sources[p.Name]=p end end
    local newRoots,holders={},{}
    local function build(b)
      local source=sources[b.Name];assert(source,"Missing animation bone: "..b.Name)
      local p=Instance.new("Pose");p.Name=b.Name;p.CFrame=source.CFrame;p.Weight=source.Weight
      p.EasingStyle=source.EasingStyle;p.EasingDirection=source.EasingDirection
      for _,c in ipairs(b:GetChildren()) do if c:IsA("Bone") then build(c).Parent=p end end
      return p
    end
    for _,b in ipairs(roots) do
      local part=b:FindFirstAncestorWhichIsA("BasePart")
      assert(part,"Bone root needs a MeshPart ancestor: "..b.Name)
      local holder=holders[part]
      if not holder then holder=Instance.new("Pose");holder.Name=part.Name;holder.Weight=0;holders[part]=holder;table.insert(newRoots,holder) end
      build(b).Parent=holder
    end
    for _,old in ipairs(frame:GetChildren()) do if old:IsA("Pose") then old:Destroy() end end
    for _,p in ipairs(newRoots) do p.Parent=frame end
  end
  table.insert(prepared,copy)
end
-- ACE stores KeyframeSequences in ServerStorage, referenced through ObjectValues.
local storage=Instance.new("Folder");storage.Name="CodexDesign_"..rig.Name.."_"..game:GetService("HttpService"):GenerateGUID(false)
local refs=Instance.new("Folder");refs.Name="AnimSaves"
for _,seq in ipairs(prepared) do seq.Parent=storage;local ref=Instance.new("ObjectValue");ref.Name=seq.Name;ref.Value=seq;ref.Parent=refs end
storage.Parent=game:GetService("ServerStorage");refs.Parent=rig
local controller=rig:FindFirstChildOfClass("AnimationController") or rig:FindFirstChildOfClass("Humanoid")
if not controller then controller=Instance.new("AnimationController");controller.Parent=rig end
if not controller:FindFirstChildOfClass("Animator") then Instance.new("Animator",controller) end
saves.Name="AnimSaves_Source"
print("Installed editable animation references:",#prepared,"in",storage:GetFullName())
`;
