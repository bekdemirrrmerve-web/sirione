export const config={maxDuration:60};
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Sadece POST'});
  res.setHeader('Cache-Control','no-store');
  try{
    const key=process.env.GEMINI_API_KEY;if(!key)return res.status(503).json({ok:false,error:'GEMINI_API_KEY tanımlı değil'});
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    const text=String(body.text||'').replace(/[*#_`>|]/g,'').trim();
    if(!text||text.length>3000)return res.status(400).json({ok:false,error:'Ses metni 1–3000 karakter olmalı'});
    const voiceId=body.voiceId||process.env.GEMINI_VOICE_ID||'';
    if(voiceId&&!/^voice_[A-Za-z0-9_-]+$/.test(voiceId))return res.status(400).json({ok:false,error:'Ses profili kimliği geçersiz'});
    const model=process.env.GEMINI_TTS_MODEL||'gemini-3.8-flash-tts';
    const headers={'Content-Type':'application/json','x-goog-api-key':key};
    let bytes,mime;
    if(voiceId){
      const r=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers,signal:AbortSignal.timeout(50000),body:JSON.stringify({model,input:[{type:'user_input',content:[{type:'text',text,annotations:[{type:'speech_metadata',style:'warm and conversational, Turkish'}]}]}],response_format:{type:'audio'},generation_config:{speech_config:[{voice:voiceId}]}})});
      if(!r.ok)return res.status(502).json({ok:false,error:`Merve Voice ses üretimi başarısız (${r.status}); ses profili ve model erişimini kontrol et.`});
      const data=await r.json();
      const part=data.output_audio||data.steps?.filter(s=>s.type==='model_output').flatMap(s=>s.content||[]).filter(p=>p.type==='audio').at(-1);
      if(!part?.data)throw new Error('Merve Voice ses döndürmedi');
      bytes=Buffer.from(part.data,'base64');mime=String(part.mime_type||part.mimeType||'audio/wav');
    }else{
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers,signal:AbortSignal.timeout(50000),body:JSON.stringify({contents:[{parts:[{text}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:process.env.GEMINI_TTS_VOICE||'Kore'}}}}})});
      if(!r.ok)return res.status(502).json({ok:false,error:`Gemini ses servisi ${r.status} döndürdü`});
      const data=await r.json(),part=data.candidates?.[0]?.content?.parts?.find(p=>p.inlineData?.data)?.inlineData;
      if(!part)throw new Error('Gemini ses döndürmedi');bytes=Buffer.from(part.data,'base64');mime=String(part.mimeType||'audio/pcm;rate=24000');
    }
    if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE')return res.json({ok:true,audio:bytes.toString('base64'),mime:'audio/wav'});
    if(/mpeg|mp3|ogg|flac/i.test(mime))return res.json({ok:true,audio:bytes.toString('base64'),mime});
    if(!/pcm|l16/i.test(mime))throw new Error('Ses biçimi tanınmadı');
    const rate=Number(mime.match(/rate=(\d+)/i)?.[1]||24000);if(rate<8000||rate>96000)throw new Error('Ses örnekleme hızı geçersiz');
    const head=Buffer.alloc(44);head.write('RIFF');head.writeUInt32LE(36+bytes.length,4);head.write('WAVE',8);head.write('fmt ',12);head.writeUInt32LE(16,16);head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);head.writeUInt32LE(rate,24);head.writeUInt32LE(rate*2,28);head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);head.write('data',36);head.writeUInt32LE(bytes.length,40);
    return res.json({ok:true,audio:Buffer.concat([head,bytes]).toString('base64'),mime:'audio/wav',rate});
  }catch(error){return res.status(502).json({ok:false,error:error.name==='TimeoutError'?'Ses servisi zaman aşımına uğradı':error.message})}
}
