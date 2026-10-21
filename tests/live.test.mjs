import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import chat from '../api/chat.js';
test('document requests stream and receive a full document token budget',async()=>{
 process.env.GEMINI_API_KEY='mock';let input;global.fetch=async(url,options)=>{input=JSON.parse(options.body);return new Response('data: {"candidates":[{"content":{"parts":[{"text":"Rapor"}]}}]}\n\n')};
 const res={chunks:[],setHeader(){},flushHeaders(){this.flushed=true},write(x){this.chunks.push(x)},end(){this.ended=true},status(){return this},json(){}};
 await chat({method:'POST',body:{stream:true,document:true,messages:[{role:'user',content:'PDF rapor'}]}},res);
 assert.equal(input.generationConfig.maxOutputTokens,4096);assert.match(input.system_instruction.parts[0].text,/eksiksiz/);assert.equal(res.flushed,true);assert.equal(res.ended,true);
});
test('live capture streams while assistant is speaking and interrupts queued output',async()=>{
 const code=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(code,/activityHandling:'START_OF_ACTIVITY_INTERRUPTS'/);assert.match(code,/silenceDurationMs:500/);assert.match(code,/if\(sc.interrupted\)\{stopLivePlayback\(\)/);
 const capture=code.slice(code.indexOf('function startLiveCapture'),code.indexOf('function stopLiveCapture'));
 assert.doesNotMatch(capture,/if\s*\(speakingNow\)/);assert.match(capture,/2048/);
});
test('PDF content uses textContent and clone controls are absent',async()=>{
 const code=await readFile(new URL('../live-chat.js',import.meta.url),'utf8');assert.match(code,/article.textContent=text/);assert.doesNotMatch(code,/fetch\('\/api\/tts/);assert.match(code,/removeItem\('sirius.merveVoiceId'\)/);
});
