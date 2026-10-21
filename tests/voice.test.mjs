import test from 'node:test';
import assert from 'node:assert/strict';
import chat from '../api/chat.js';
import tts from '../api/tts.js';
import profile from '../api/voice-profile.js';
const response=()=>({statusCode:200,headers:{},chunks:[],status(n){this.statusCode=n;return this},setHeader(k,v){this.headers[k]=v},json(d){this.data=d;return this},write(d){this.chunks.push(d)},flushHeaders(){this.flushed=true},end(){this.ended=true}});
const originalFetch=global.fetch;
process.env.GEMINI_API_KEY='test-only';
test('chat streams upstream before waiting for complete audio',async()=>{
  global.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"Merhaba."}]}}]}\n\n'));c.close()}}));
  const res=response();await chat({method:'POST',body:{stream:true,messages:[{role:'user',content:'Selam'}]}},res);
  assert.equal(res.flushed,true);assert.equal(res.ended,true);assert.match(Buffer.concat(res.chunks).toString(),/Merhaba/);
});
test('clone TTS uses voice ID and never falls back after provider rejection',async()=>{
  let calls=0;global.fetch=async(url,opts)=>{calls++;assert.match(url,/interactions$/);assert.equal(JSON.parse(opts.body).generation_config.speech_config[0].voice,'voice_test');return new Response('{}',{status:403})};
  const res=response();await tts({method:'POST',body:{text:'Merhaba',voiceId:'voice_test'}},res);assert.equal(res.statusCode,502);assert.equal(calls,1);assert.equal(res.data.ok,false);
});
test('PCM rate is honored in WAV header',async()=>{
  global.fetch=async()=>Response.json({candidates:[{content:{parts:[{inlineData:{data:Buffer.alloc(16).toString('base64'),mimeType:'audio/pcm;rate=16000'}}]}}]});
  const res=response();await tts({method:'POST',body:{text:'Merhaba'}},res);assert.equal(Buffer.from(res.data.audio,'base64').readUInt32LE(24),16000);
});
test('profile refuses absent explicit consent without upstream call',async()=>{
  global.fetch=()=>{throw new Error('must not be called')};const res=response();await profile({method:'POST',body:{confirm:false}},res);assert.equal(res.statusCode,400);
});
test('profile rejects invalid WAV bytes',async()=>{
  const res=response();await profile({method:'POST',body:{confirm:true,source:'YWJj',consent:'YWJj'}},res);assert.equal(res.statusCode,400);
});
test('missing key is explicit',async()=>{
  delete process.env.GEMINI_API_KEY;const res=response();await tts({method:'POST',body:{text:'Hi'}},res);assert.equal(res.statusCode,503);process.env.GEMINI_API_KEY='test-only';global.fetch=originalFetch;
});
test('voice queue begins synthesis on first sentence and preserves playback order',async()=>{
  const {readFile}=await import('node:fs/promises');const code=await readFile(new URL('../fast-voice.js',import.meta.url),'utf8');
  const fn=code.slice(code.indexOf('function voiceQueue('),code.indexOf('\nask = async'));
  const fetched=[],played=[],controllers=new Set();
  const make=new Function('voiceEnabled','fetchVoice','activeVoiceControllers','playGeminiAudio','setMode',`let voiceTurn=1,speakingNow=false;${fn};return voiceQueue;`);
  const queue=make({checked:true},async text=>{fetched.push(text);return text},controllers,async audio=>played.push(audio),()=>{})(1);
  queue.push('İlk cümle hazır. ');assert.equal(fetched.length,1);queue.push('İkinci cümle burada.');await queue.finish();assert.equal(fetched.length,2);assert.deepEqual(played,fetched);
});
