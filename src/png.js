// Minimal PNG → RGBA decoder for Node-side builds (inspect/tests). Browsers decode images natively.
// Supports 8/16-bit grayscale, RGB, palette (1–8 bit), gray+alpha and RGBA, non-interlaced.
export function decodePNG(bytes,inflate) {
  const u8=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),view=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  const sig=[137,80,78,71,13,10,26,10];if(!sig.every((b,i)=>u8[i]===b))throw new Error('Not a PNG file');
  let width,height,depth,type,interlace,palette,trns;const idat=[];
  for(let o=8;o<u8.length;){
    const len=view.getUint32(o),name=String.fromCharCode(...u8.subarray(o+4,o+8)),start=o+8,data=u8.subarray(start,start+len);o+=12+len;
    if(name==='IHDR'){width=view.getUint32(start);height=view.getUint32(start+4);depth=data[8];type=data[9];interlace=data[12];}
    else if(name==='PLTE')palette=data;else if(name==='tRNS')trns=data;else if(name==='IDAT')idat.push(data);else if(name==='IEND')break;
  }
  if(interlace)throw new Error('Interlaced PNG is not supported');
  const channels={0:1,2:3,3:1,4:2,6:4}[type];if(!channels)throw new Error(`Unsupported PNG color type ${type}`);
  const total=idat.reduce((n,d)=>n+d.length,0),joined=new Uint8Array(total);let p=0;for(const d of idat){joined.set(d,p);p+=d.length;}
  const raw=inflate(joined),bitsPerPixel=channels*depth,stride=Math.ceil(width*bitsPerPixel/8),bpp=Math.max(1,bitsPerPixel>>3);
  const rows=new Uint8Array(stride*height);let prev=new Uint8Array(stride);
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)],line=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)),out=rows.subarray(y*stride,(y+1)*stride);
    for(let x=0;x<stride;x++){
      const a=x>=bpp?out[x-bpp]:0,b=prev[x],c=x>=bpp?prev[x-bpp]:0;let v=line[x];
      if(filter===1)v+=a;else if(filter===2)v+=b;else if(filter===3)v+=(a+b)>>1;
      else if(filter===4){const pp=a+b-c,pa=Math.abs(pp-a),pb=Math.abs(pp-b),pc=Math.abs(pp-c);v+=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
      out[x]=v&255;
    }
    prev=out;
  }
  const rgba=new Uint8ClampedArray(width*height*4),sample=(row,i)=>{
    if(depth===8)return row[i];if(depth===16)return row[i*2];
    const perByte=8/depth,byte=row[Math.floor(i/perByte)],shift=8-depth*(i%perByte+1);return (byte>>shift)&((1<<depth)-1);
  };
  for(let y=0;y<height;y++){
    const row=rows.subarray(y*stride,(y+1)*stride);
    for(let x=0;x<width;x++){
      const o=(y*width+x)*4,s=i=>sample(row,x*channels+i),scale=v=>type===3||depth>=8?v:Math.round(v*255/((1<<depth)-1));
      if(type===3){const i=s(0);rgba[o]=palette[i*3];rgba[o+1]=palette[i*3+1];rgba[o+2]=palette[i*3+2];rgba[o+3]=trns&&i<trns.length?trns[i]:255;}
      else if(type===0||type===4){const g=scale(s(0));rgba[o]=rgba[o+1]=rgba[o+2]=g;rgba[o+3]=type===4?s(1):255;}
      else{rgba[o]=s(0);rgba[o+1]=s(1);rgba[o+2]=s(2);rgba[o+3]=type===6?s(3):255;}
    }
  }
  return {width,height,data:rgba};
}

/** Minimal RGBA → PNG encoder for Node-side writers (texture CLI). Rows top→bottom; pass flipY for v-up DataTexture rows. */
export function encodePNG(rgba,width,height,deflate,{flipY=false}={}) {
  const crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
  const crc=b=>{let c=0xffffffff;for(let i=0;i<b.length;i++)c=crcTable[(c^b[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  const stride=width*4,raw=new Uint8Array((stride+1)*height);
  for(let y=0;y<height;y++){const src=flipY?height-1-y:y;raw[y*(stride+1)]=0;raw.set(rgba.subarray(src*stride,(src+1)*stride),y*(stride+1)+1);}
  const chunk=(name,data)=>{const out=new Uint8Array(12+data.length),view=new DataView(out.buffer);view.setUint32(0,data.length);for(let i=0;i<4;i++)out[4+i]=name.charCodeAt(i);out.set(data,8);view.setUint32(8+data.length,crc(out.subarray(4,8+data.length)));return out;};
  const ihdr=new Uint8Array(13),hv=new DataView(ihdr.buffer);hv.setUint32(0,width);hv.setUint32(4,height);ihdr.set([8,6,0,0,0],8);
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',new Uint8Array(deflate(raw))),chunk('IEND',new Uint8Array(0))];
  const total=parts.reduce((n,p)=>n+p.length,0),png=new Uint8Array(total);let o=0;for(const p of parts){png.set(p,o);o+=p.length;}return png;
}
