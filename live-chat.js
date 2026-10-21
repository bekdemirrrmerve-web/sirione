// Text is silent. Only the direct Gemini Live connection produces speech.
let textRequest=null,textTurn=0;
const baseStopVoice=stopVoice;
stopVoice=function(){textTurn++;textRequest?.abort();baseStopVoice()};
speakText=function(){deviceLog.textContent='Sesli sohbet için CANLI KONUŞ düğmesini kullan.'};
function pdfDocument(text){
  const popup=window.open('','_blank');if(!popup){deviceLog.textContent='PDF için açılır pencereye izin ver.';return}
  const doc=popup.document;doc.title='Sirius Belgesi';
  const style=doc.createElement('style');style.textContent='@page{size:A4;margin:20mm}body{font:12pt system-ui,sans-serif;color:#111;line-height:1.6}article{white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:18pt}button{padding:12px;margin-bottom:20px}@media print{button{display:none}}';doc.head.appendChild(style);
  const button=doc.createElement('button');button.textContent='PDF olarak kaydet / Yazdır';button.onclick=()=>popup.print();
  const title=doc.createElement('h1');title.textContent='Sirius';const article=doc.createElement('article');article.textContent=text;doc.body.append(button,title,article);popup.focus();
}
const baseRender=render;
render=function(){baseRender();
  const rows=(state.messages||[]).slice(-30);
  for(const target of ['chatMessages','liveLog']){
    const nodes=document.getElementById(target)?.querySelectorAll('.log')||[];
    rows.forEach((message,index)=>{if(message.role==='user'||!message.content||!nodes[index])return;const b=document.createElement('button');b.className='btn';b.style.margin='8px';b.textContent='PDF olarak kaydet';b.onclick=()=>pdfDocument(message.content);nodes[index].appendChild(b)});
  }
};
ask=async function(value){
  const text=String(value||'').trim();if(!text)return;
  textRequest?.abort();const turn=++textTurn;const controller=new AbortController();textRequest=controller;
  state.messages||=[];state.messages.push({role:'user',content:text});const history=state.messages.slice(-16).map(m=>({role:m.role,content:m.content}));const answer={role:'assistant',content:''};state.messages.push(answer);render();
  if(!liveConnected)setMode('thinking','THINKING');
  try{
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({messages:history,stream:true,document:/\bpdf\b|belge|rapor|doküman|dokuman/i.test(text)})});
    if(!response.ok){const d=await response.json();throw new Error(d.error||'Yanıt alınamadı')}
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    function consume(line){if(!line.startsWith('data:'))return;const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')return;const d=JSON.parse(raw);if(d.error)throw new Error(d.error.message||'Yanıt kesildi');const delta=(d.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');if(turn===textTurn&&delta){answer.content+=delta;render()}}
    while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)consume(line)}buffer+=decoder.decode();if(buffer.trim())consume(buffer);
    if(!answer.content.trim())throw new Error('Gemini boş yanıt döndürdü');
  }catch(e){if(controller.signal.aborted)return;if(!answer.content)answer.content='Yanıt alınamadı: '+e.message;deviceLog.textContent=e.message}
  finally{if(turn===textTurn){if(!liveConnected)setMode('','STANDBY');await save()}}
};
// Remove obsolete clone/TTS controls without changing the green layout.
document.querySelector('[onclick^="speakText("]')?.remove();
const listenButton=document.getElementById('listenBtn');listenButton.textContent='● CANLI KONUŞ';listenButton.onclick=()=>toggleConversation();
conversationBtn.textContent='◉ CANLI KONUŞ / DURDUR';
const settings=document.querySelector('#settings .card');
for(const row of settings.querySelectorAll('.deviceRow')){if(row.querySelector('#voiceEnabled,#voiceSelect'))row.remove()}
const note=settings.querySelector('p');if(note)note.textContent='Doğrudan Gemini Live ile konuş. Konuşurken araya girdiğinde Sirius sesini durdurur ve seni dinler. Yazılı cevaplar sessizdir; PDF olarak kaydedebilirsin.';
try{localStorage.removeItem('sirius.merveVoiceId')}catch{}
window.addEventListener('pagehide',()=>{textRequest?.abort();stopLiveConversation()});render();
