const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function harness({failStart=false, failPublish=false, failStop=false, tauri=true, inputDevice=null, failNormal=false, failDuringStart=false}={}) {
 const listeners=new Map();
 const calls=[]; const track={stop(){calls.push('track.stop')}};
 class AudioContext { constructor(){this.state='running';this.currentTime=1;} createMediaStreamDestination(){return {stream:{getAudioTracks:()=>[track],getTracks:()=>[track]}};} createGain(){return {gain:{value:1},connect(){},disconnect(){}}} async close(){calls.push('close')} async resume(){} createBuffer(c,n,sr){calls.push(['buffer',c,n,sr]);return {duration:n/sr,copyToChannel(){}}} createBufferSource(){return {connect(){},start(t){calls.push(['start',t])},disconnect(){}}} }
 const api={core:{async invoke(cmd){calls.push(cmd);if(cmd==='start_audio_processor'&&failStart)throw Error('start');if(cmd==='start_audio_processor'&&failDuringStart)listeners.get('audio-error')?.({payload:'startup device error'});if(cmd==='stop_audio_processor'&&failStop)throw Error('stop');if(cmd==='get_audio_info')return {sample_rate:44100,channels:2};}},event:{async listen(name,fn){calls.push('listen');listeners.set(name,fn);return ()=>{calls.push('unlisten');listeners.delete(name)}}}};
 const window={AudioContext,dispatchEvent(event){calls.push(['uiError',event.detail])},...(tauri?{__TAURI__:api}:{})};
 const ctx=vm.createContext({window,console:{log(){},warn(){},error(){}},CustomEvent:class {constructor(type,options){this.detail=options.detail}},Float32Array,setTimeout,clearTimeout,setInterval,clearInterval,HTMLMediaElement:class {},localStorage:{getItem(key){return key==='voice_chat_input_device'?inputDevice:null}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/js/tauri-audio.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/js/livekit.js'),'utf8'),ctx);
 const client=window.livekitClient;
 const lp={trackPublications:new Map(),audioTrackPublications:new Map(),async publishTrack(t){calls.push('publish');if(failPublish)throw Error('publish');const p={track:t,source:'microphone'};this.trackPublications.set('mic',p);return p;},async unpublishTrack(){calls.push('unpublish')},async setMicrophoneEnabled(enabled,opts){calls.push(['micEnabled',enabled,opts]);if(failNormal)throw Error('Device unavailable');calls.push('nativeMic');this.audioTrackPublications.set('mic',{source:'microphone',track:{}})}};
 client.room={state:'connected',localParticipant:lp};client.localParticipant=lp;client._waitForRoomConnected=async()=>{};
 ctx._livekitModule={LocalAudioTrack:class {constructor(track){this.mediaStreamTrack=track}async mute(){calls.push('track.mute')}stop(){track.stop()}},Track:{Source:{Microphone:'microphone'}}};
 vm.runInContext('_livekitModule = globalThis._livekitModule',ctx);
 window.tauriAudioBridge.setLiveKitClient(client);
 return {bridge:window.tauriAudioBridge,client,calls,listeners};
}
test('real Tauri v2 namespace starts and uses capture sample rate',async()=>{const {bridge}=harness();assert.equal(await bridge.start(),true);assert.equal(bridge.sampleRate,44100);await bridge.stop()});
test('processed audio actually publishes through shared LiveKit loader',async()=>{const {bridge,client,calls}=harness();await bridge.start();await client.publishMicrophone();assert.ok(calls.includes('publish'));assert.ok(!calls.includes('nativeMic'));await bridge.stop();assert.ok(calls.includes('unpublish'))});
test('publication failure cleans native capture and falls back to microphone',async()=>{const {bridge,client,calls}=harness({failPublish:true});await bridge.start();await client.publishMicrophone();assert.ok(calls.includes('nativeMic'));assert.equal(bridge.isRunning,false);assert.ok(calls.includes('close'))});
test('partial startup failure cleans listener and context',async()=>{const {bridge,calls}=harness({failStart:true});assert.equal(await bridge.start(),false);assert.ok(calls.includes('unlisten'));assert.ok(calls.includes('close'));assert.equal(bridge.isRunning,false)});
test('normal browser microphone publishes',async()=>{const {client,calls}=harness({tauri:false});await client.publishMicrophone();assert.ok(calls.includes('nativeMic'))});
test('stop error still clears all local resources',async()=>{const {bridge,calls}=harness({failStop:true});await bridge.start();await bridge.stop();assert.equal(bridge.isRunning,false);assert.ok(calls.includes('close'));assert.ok(calls.includes('track.stop'))});
test('PCM chunks are scheduled consecutively instead of overlapping',async()=>{const {bridge,calls}=harness();await bridge.start();bridge.processAudioData([0,0,0,0]);bridge.processAudioData([0,0,0,0]);const times=calls.filter(x=>Array.isArray(x)&&x[0]==='start').map(x=>x[1]);assert.ok(times[1]>times[0]);await bridge.stop()});
test('desktop exposes namespaced API only to the deployed origin for event receive',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../src-tauri/tauri.conf.json')));
 const cap=JSON.parse(fs.readFileSync(path.join(__dirname,'../src-tauri/capabilities/main.json')));
 assert.equal(config.app.withGlobalTauri,true);
 assert.deepEqual(cap.remote.urls,['https://voice-chat-production-a794.up.railway.app']);
 assert.deepEqual(cap.permissions,['core:event:allow-listen','core:event:allow-unlisten']);
});
test('repeat processed publish and stop are idempotent',async()=>{const {bridge,client,calls}=harness();await bridge.start();await client.publishMicrophone();await client.publishMicrophone();assert.equal(calls.filter(x=>x==='publish').length,1);await Promise.all([bridge.stop(),bridge.stop()]);assert.equal(calls.filter(x=>x==='close').length,1)});
test('processed microphone volume uses live output without replacing its source',async()=>{const {bridge,client,calls}=harness();await bridge.start();await client.publishMicrophone();await client.setMicVolume(25);assert.equal(bridge.outputGain.gain.value,0.25);assert.equal(calls.filter(x=>x==='publish').length,1);await bridge.stop()});
test('failed native start still publishes normal microphone',async()=>{const {bridge,client,calls}=harness({failStart:true});assert.equal(await bridge.start(),false);await client.publishMicrophone();assert.ok(calls.includes('nativeMic'))});
test('screen audio alone does not count as a published microphone',async()=>{const {client}=harness({tauri:false});client.localParticipant.setMicrophoneEnabled=async()=>{};client.localParticipant.audioTrackPublications.set('screen',{source:'screen_share_audio',track:{}});await assert.rejects(()=>client.publishMicrophone(),/Microphone track was not published/)});
test('processed publish preserves muted state before sending a track',async()=>{const {bridge,client,calls}=harness();client._isMuted=true;await bridge.start();await client.publishMicrophone();assert.ok(calls.indexOf('track.mute')>=0);assert.ok(calls.indexOf('track.mute')<calls.indexOf('publish'));await bridge.stop()});
test('native AGC does not replace or stop processed source',async()=>{const {bridge,client,calls}=harness();await bridge.start();await client.publishMicrophone();client.localParticipant.getTrackPublication=()=>({track:bridge.localAudioTrack,audioTrack:bridge.localAudioTrack});await client.setAutoGain(true);assert.ok(!calls.includes('unpublish'));assert.equal(client._micGainNode,null);await bridge.stop()});

test('runtime device error cleans native listeners and recovers ordinary mic',async()=>{
 const {bridge,client,calls,listeners}=harness();await bridge.start();await client.publishMicrophone();
 assert.ok(listeners.has('audio-error'));listeners.get('audio-error')({payload:'device disconnected'});await bridge.recovery;
 assert.equal(bridge.isRunning,false);assert.equal(listeners.size,0);assert.ok(calls.includes('nativeMic'));
});
test('runtime fallback preserves mute and does not enable capture',async()=>{
 const {bridge,client,calls,listeners}=harness();client._isMuted=true;await bridge.start();await client.publishMicrophone();
 listeners.get('audio-error')({payload:'device disconnected'});await bridge.recovery;
 const enabled=calls.filter(x=>Array.isArray(x)&&x[0]==='micEnabled');assert.equal(enabled.at(-1)[1],false);
});
test('runtime recovery failure raises actionable UI event',async()=>{
 const {bridge,client,calls,listeners}=harness({failNormal:true});await bridge.start();await client.publishMicrophone();
 listeners.get('audio-error')({payload:'device disconnected'});await bridge.recovery;
 assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='uiError'&&x[1].includes('micrófono')));
});
test('specific browser device bypasses default native device and is passed to SDK',async()=>{
 const {bridge,client,calls}=harness({inputDevice:'opaque-device-id'});assert.equal(await bridge.start(),false);await client.publishMicrophone();
 assert.ok(!calls.includes('start_audio_processor'));assert.equal(calls.find(x=>Array.isArray(x)&&x[0]==='micEnabled')[2].deviceId,'opaque-device-id');
});

test('device error during startup aborts and cleans instead of marking dead capture running',async()=>{
 const {bridge,client,calls,listeners}=harness({failDuringStart:true});assert.equal(await bridge.start(),false);
 assert.equal(bridge.isRunning,false);assert.equal(listeners.size,0);await client.publishMicrophone();assert.ok(calls.includes('nativeMic'));
});
