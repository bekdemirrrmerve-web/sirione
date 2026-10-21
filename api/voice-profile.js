export const config={maxDuration:60};
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const key=process.env.GEMINI_API_KEY;
  if(req.method==='GET')return res.status(200).json({ok:true,configured:Boolean(key),voiceId:process.env.GEMINI_VOICE_ID||''});
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Sadece POST'});
  if(!key)return res.status(503).json({ok:false,error:'Vercel ayarlarında GEMINI_API_KEY eksik'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    if(body.action==='analyze'){
      if(typeof body.audio!=='string'||body.audio.length>3500000)return res.status(400).json({ok:false,error:'Kayıt boyutu en fazla 2,5 MB olmalı'});
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_CHAT_MODEL||'gemini-2.5-flash')}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal:AbortSignal.timeout(50000),body:JSON.stringify({contents:[{parts:[{inlineData:{mimeType:body.mime||'audio/mp4',data:body.audio}},{text:'Bu ses kaydını dinle. İzin cümlesini kelimesi kelimesine yaz, başlangıç ve bitiş saniyelerini belirt. Beklenen: Bu sesin sahibi benim ve Google\'ın bu sesi kullanarak sentetik bir ses modeli oluşturmasına izin veriyorum. Bütün cümle duyulmuyorsa consentFound false. Ayrıca izin cümlesi dışında aynı kişinin 10–30 saniyelik kesintisiz doğal konuşmasını seç. Uydurma, yoksa null. JSON: {consentFound:boolean,consentText:string,consentStart:number|null,consentEnd:number|null,referenceStart:number|null,referenceEnd:number|null}'}]}],generationConfig:{responseMimeType:'application/json',thinkingConfig:{thinkingBudget:0}}})});
      if(!r.ok)return res.status(502).json({ok:false,error:`Ses çözümleme servisi ${r.status} döndürdü`});
      const data=await r.json();const result=JSON.parse(data.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('')||'null');
      return res.json({ok:true,result});
    }
    if(body.confirm!==true)return res.status(400).json({ok:false,error:'Ses profili oluşturma onayı gerekli'});
    for(const [name,min,max] of [['source',10,30],['consent',1,60]]){
      const b64=body[name];if(typeof b64!=='string'||b64.length>3900000||! /^[A-Za-z0-9+/]+={0,2}$/.test(b64))throw new Error('Geçerli WAV kaydı gerekli');
      const wav=Buffer.from(b64,'base64');
      if(wav.length<44||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE'||wav.readUInt32LE(24)!==24000||wav.readUInt16LE(22)!==1||wav.readUInt16LE(34)!==16||wav.toString('ascii',36,40)!=='data')throw new Error('24kHz mono PCM16 WAV gerekli');
      const seconds=wav.readUInt32LE(40)/48000;if(seconds<min||seconds>max||wav.length!==44+wav.readUInt32LE(40))throw new Error(name==='source'?'Doğal konuşma 10–30 saniye olmalı':'İzin kaydı 1–60 saniye olmalı');
    }
    const r=await fetch('https://generativelanguage.googleapis.com/v1beta/voices',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal:AbortSignal.timeout(50000),body:JSON.stringify({store:true,voice:{model:process.env.GEMINI_TTS_MODEL||'gemini-3.8-flash-tts',type:'replicated',display_name:'Merve Voice',replicated:{source_audio:{mime_type:'audio/wav',data:body.source},consent_audio:{mime_type:'audio/wav',data:body.consent}}}})});
    if(!r.ok)return res.status(502).json({ok:false,error:`Google ses profili oluşturmadı (${r.status}). Hesabın ses klonlama erişimini ve izin kaydını kontrol et.`});
    const data=await r.json();if(!/^voice_[A-Za-z0-9_-]+$/.test(data.id||''))throw new Error('Google geçerli ses kimliği döndürmedi');
    return res.json({ok:true,voiceId:data.id});
  }catch(error){return res.status(400).json({ok:false,error:error.name==='TimeoutError'?'Ses servisi zaman aşımına uğradı':error.message})}
}
