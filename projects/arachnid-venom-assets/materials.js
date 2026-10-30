/** Procedural 1K PBR surfaces for the Venom Arachnid. Textures remain embedded in GLB. */
export async function createMaterials(THREE) {
  const armor = new THREE.MeshStandardMaterial({name:'Chitin_Titanium',color:'#263c4c',roughness:.41,metalness:.78});
  const edge = new THREE.MeshStandardMaterial({name:'Worn_Bronze_Edges',color:'#85765b',roughness:.31,metalness:.87});
  const dark = new THREE.MeshStandardMaterial({name:'Flexible_Obsidian',color:'#101e23',roughness:.57,metalness:.34});
  const venom = new THREE.MeshStandardMaterial({name:'Bioluminescent_Venom',color:'#30cf64',roughness:.26,metalness:.12,emissive:'#29f88b',emissiveIntensity:.52});
  const glow = new THREE.MeshStandardMaterial({name:'Cyan_Green_Photophores',color:'#47ffd1',roughness:.22,metalness:.2,emissive:'#00ff8b',emissiveIntensity:1.5});
  const bone = new THREE.MeshStandardMaterial({name:'Black_Chrome_Fangs',color:'#768c89',roughness:.27,metalness:.85});
  if (typeof document !== 'undefined') {
    const loader = new THREE.TextureLoader();
    async function load(name, srgb=false) {
      const t = await loader.loadAsync(new URL(name+'.png',import.meta.url).href);
      t.name=name;
      t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;
      t.wrapS=t.wrapT=THREE.RepeatWrapping;
      t.anisotropy=8;
      return t;
    }
    const [ab,an,ar,am,vb,vn,vr,vm,ve] = await Promise.all([
      load('armor_basecolor',true),load('armor_normal'),load('armor_roughness'),load('armor_metallic'),
      load('venom_basecolor',true),load('venom_normal'),load('venom_roughness'),load('venom_metallic'),load('venom_emissive',true)
    ]);
    armor.color.set('#ffffff'); armor.roughness=1; armor.metalness=1;
    Object.assign(armor,{map:ab,normalMap:an,roughnessMap:ar,metalnessMap:am});
    armor.normalScale.set(.75,.75);
    dark.normalMap=an;dark.normalScale.set(.30,.30);
    edge.normalMap=an;edge.normalScale.set(.22,.22);
    bone.normalMap=an;bone.normalScale.set(.30,.30);
    venom.color.set('#ffffff');venom.emissive.set('#ffffff');venom.roughness=1;venom.metalness=1;
    Object.assign(venom,{map:vb,normalMap:vn,roughnessMap:vr,metalnessMap:vm,emissiveMap:ve});
    venom.normalScale.set(.70,.70);
  }
  return {armor,edge,dark,venom,glow,bone};
}
