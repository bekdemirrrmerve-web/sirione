// Shared with the existing green console; no layout replacement.
let voiceTurn = 0, voiceRequest = null, activeVoiceControllers = new Set();
const originalStopVoice = stopVoice;
stopVoice = function () {
  voiceTurn++;
  voiceRequest?.abort();
  activeVoiceControllers.forEach(c => c.abort()); activeVoiceControllers.clear();
  originalStopVoice();
};
function voiceId() { try { return localStorage.getItem('sirius.merveVoiceId') || ''; } catch { return ''; } }
async function fetchVoice(text, signal) {
  const response = await fetch('/api/tts', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text, voiceId:voiceId()}), signal});
  const data = await response.json();
  if (!response.ok || !data.ok || !data.audio) throw new Error(data.error || 'Ses hazırlanamadı');
  return data;
}
function voiceQueue(turn) {
  let pending = '', playback = Promise.resolve(), failed = null;
  function enqueue(text) {
    if (!text.trim() || !voiceEnabled.checked) return;
    // Start synthesis immediately while the preceding audio is playing.
    const controller = new AbortController(); activeVoiceControllers.add(controller);
    const audio = fetchVoice(text, controller.signal).then(data=>({data}), error=>({error})).finally(()=>activeVoiceControllers.delete(controller));
    playback = playback.then(async()=>{
      const result = await audio;
      if(turn !== voiceTurn) return;
      if(result.error){ failed = result.error; return; }
      speakingNow = true; setMode('speaking','SPEAKING');
      await playGeminiAudio(result.data);
    }).catch(error=>{failed=error});
  }
  return {
    push(text) {
      pending += text;
      // Wait for punctuation plus whitespace to avoid cutting decimal numbers.
      let match;
      while((match = pending.match(/^([\s\S]*?[.!?。](?:\s+|$))/)) && match[1].trim().length >= 12) {
        enqueue(match[1]); pending=pending.slice(match[1].length);
      }
    },
    async finish() {enqueue(pending); pending=''; await playback; if(failed && turn === voiceTurn) throw failed;}
  };
}
ask = async function(value) {
  const text = String(value || '').trim(); if(!text) return;
  stopVoice(); const turn=voiceTurn;
  unlockAudio(); try {if(recognition && listening) recognition.stop()}catch{}
  speakingNow=true;
  state.messages ||= []; state.messages.push({role:'user',content:text});
  const history=state.messages.slice(-16).map(m=>({role:m.role,content:m.content}));
  const answer={role:'assistant',content:''}; state.messages.push(answer); render();
  setMode('thinking','THINKING');
  voiceRequest=new AbortController(); const signal=voiceRequest.signal;
  const queue=voiceQueue(turn); const started=performance.now(); let first=true;
  try {
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history,stream:true}),signal});
    if(!response.ok){const d=await response.json();throw new Error(d.error || 'Yanıt alınamadı')}
    const reader=response.body.getReader(), decoder=new TextDecoder(); let buffer='';
    function consume(line){
      if(!line.startsWith('data:'))return;
      const raw=line.slice(5).trim(); if(!raw || raw==='[DONE]')return;
      const d=JSON.parse(raw); if(d.error)throw new Error(d.error.message || 'Gemini yanıtı kesildi');
      const delta=(d.candidates?.[0]?.content?.parts || []).filter(p=>!p.thought).map(p=>p.text || '').join('');
      if(!delta || turn!==voiceTurn)return;
      if(first){console.info('Sirius first text (ms)',Math.round(performance.now()-started));first=false}
      answer.content+=delta; render(); queue.push(delta);
    }
    while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)consume(line)}
    buffer+=decoder.decode();if(buffer.trim())consume(buffer);
    if(!answer.content.trim())throw new Error('Gemini boş cevap döndürdü');
    await queue.finish();
  } catch(error) {
    if(turn!==voiceTurn || signal.aborted)return;
    activeVoiceControllers.forEach(c=>c.abort());
    deviceLog.textContent=error.message;
    if(!answer.content)answer.content='Yanıt alınamadı: '+error.message;
    else deviceLog.textContent='Ses tamamlanamadı: '+error.message;
  } finally {
    if(turn===voiceTurn){speakingNow=false;setMode('','STANDBY');await save()}
  }
};
speakText = async function(text) {
  stopVoice(); unlockAudio(); const turn=voiceTurn; speakingNow=true;
  try{if(recognition && listening)recognition.stop()}catch{}
  const queue=voiceQueue(turn);setMode('thinking','SES HAZIRLANIYOR');
  try{queue.push(String(text||''));await queue.finish()}catch(error){deviceLog.textContent=error.message}
  finally{if(turn===voiceTurn)afterSpeak()}
};
const setupLink=document.createElement('a');setupLink.href='/voice-setup.html';setupLink.className='btn';setupLink.textContent='MERVE VOICE KURULUMU';
document.querySelector('#settings .card').appendChild(setupLink);
const voiceNote=document.createElement('p');voiceNote.className='muted';
voiceNote.textContent=voiceId()?'Merve Voice kayıtlı. Yazılı sohbet yanıtları bu sesle okunur. Live modu kendi Gemini sesini kullanır.':'Merve Voice henüz kurulmadı. Şu an Gemini hazır sesi kullanılıyor.';
setupLink.after(voiceNote);
// A cloned voice uses the text + TTS loop; Gemini Live keeps its own voice.
let cloneConversation=false,cloneRestart=null;
const fastStopVoice=stopVoice;
stopVoice=function(){cloneConversation=false;clearTimeout(cloneRestart);fastStopVoice()};
const liveToggleConversation=toggleConversation;
toggleConversation=async function(){
  if(!voiceId())return liveToggleConversation();
  if(cloneConversation){stopVoice();conversationBtn.textContent='◉ KARŞILIKLI KONUŞ';return}
  unlockAudio();if(!recognition&&!initRecognition()){deviceLog.textContent='Bu tarayıcı konuşma tanımayı desteklemiyor. Yazılı sohbeti kullanabilirsin.';return}
  cloneConversation=true;conversationBtn.textContent='◉ MERVE VOICE: AÇIK';
  recognition.onend=()=>{listening=false;if(cloneConversation&&!speakingNow)cloneRestart=setTimeout(()=>{if(cloneConversation&&!speakingNow)try{recognition.start()}catch{}},250)};
  recognition.onerror=event=>{if(['not-allowed','service-not-allowed','audio-capture'].includes(event.error)){cloneConversation=false;deviceLog.textContent='Mikrofon açılamadı: '+event.error;conversationBtn.textContent='◉ KARŞILIKLI KONUŞ'}};
  try{recognition.start()}catch(error){cloneConversation=false;deviceLog.textContent=error.message}
};
const fastAsk=ask;
ask=async function(text){const resume=cloneConversation;const expectedTurn=voiceTurn+1;await fastAsk(text);if(resume&&voiceTurn===expectedTurn){cloneConversation=true;conversationBtn.textContent='◉ MERVE VOICE: AÇIK';try{recognition.start()}catch{}}};
window.addEventListener('pagehide',()=>stopVoice());
