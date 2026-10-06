// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../src/client/App";
import { GEMINI_VOICES } from "../../src/shared/geminiVoices";
import type { SessionControllerCallbacks } from "../../src/client/voice/session";
import { PrototypeLogPanel } from '../../src/client/components/PrototypeLogPanel';
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

it('loads the server voice default and sends a bilingual selection that locks during the session', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ voices: GEMINI_VOICES, defaultVoice: 'Fenrir' }))));
  let callbacks: SessionControllerCallbacks = {};
  const connect = vi.fn(async () => callbacks.onState?.('connected'));
  render(<App createSessionController={cb => { callbacks = cb; return { connect, sendText: () => true, beginMicrophoneTurn: () => 1, sendMicrophoneAudio: () => undefined, endMicrophoneStream: () => undefined, stop: async () => callbacks.onState?.('ended') }; }} audioPlayer={{ prepare: async () => undefined, close: async () => undefined, stop: () => undefined, setMuted: () => undefined, play: async () => undefined }} />);
  const selector = screen.getByRole('combobox', { name: 'Session voice · صوت الجلسة' });
  await waitFor(() => expect(selector).toHaveValue('Fenrir'));
  expect(screen.getByRole('option', { name: 'Aoede · Breezy · خفيف' })).toBeInTheDocument();
  fireEvent.change(selector, { target: { value: 'Aoede' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await waitFor(() => expect(selector).toBeDisabled());
  expect(connect).toHaveBeenCalledWith({ simulatedCallingNumber: '0500000000', voiceName: 'Aoede' });
  act(() => callbacks.onState?.('error', 'Reconnect to continue'));
  expect(selector).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  await waitFor(() => expect(selector).toBeEnabled());
});

it('keeps the server default available if voice options cannot be loaded', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  const connect = vi.fn(async () => undefined);
  render(<App createSessionController={() => ({ connect, sendText: () => true, beginMicrophoneTurn: () => 1, sendMicrophoneAudio: () => undefined, endMicrophoneStream: () => undefined, stop: async () => undefined })} audioPlayer={{ prepare: async () => undefined, close: async () => undefined, stop: () => undefined, setMuted: () => undefined, play: async () => undefined }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await waitFor(() => expect(connect).toHaveBeenCalledWith({ simulatedCallingNumber: '0500000000' }));
});

it('updates caller bubbles by stable input ID even when an earlier final arrives late',()=>{
  let callbacks:SessionControllerCallbacks={};
  render(<App createSessionController={cb=>{callbacks=cb;return {connect:async()=>undefined,sendText:()=>true,beginMicrophoneTurn:()=>1,sendMicrophoneAudio:()=>undefined,endMicrophoneStream:()=>undefined,stop:async()=>undefined};}} audioPlayer={{prepare:async()=>undefined,close:async()=>undefined,stop:()=>undefined,setMuted:()=>undefined,play:async()=>undefined}}/>);
  act(()=>{(callbacks.onPatientTranscript as any)?.('First',false,'microphone','first');(callbacks.onPatientTranscript as any)?.('Second',false,'microphone','second');});
  expect(screen.getByText('First')).toBeInTheDocument();expect(screen.getByText('Second')).toBeInTheDocument();
  act(()=>{(callbacks.onPatientTranscript as any)?.('First completed',true,'microphone','first');(callbacks.onPatientTranscript as any)?.('Second completed',true,'microphone','second');});
  expect(screen.getByText('First completed')).toBeInTheDocument();expect(screen.getByText('Second completed')).toBeInTheDocument();expect(screen.getByText('2 messages')).toBeInTheDocument();
});

it('scrolls the log list to latest events on opening, reopening and incoming entries',()=>{
  const entry={id:'one',timestamp:'2026-10-03T05:00:00Z',type:'session' as const,message:'First event'};
  const props={onCopy:()=>undefined,onClear:()=>undefined};
  const {rerender}=render(<PrototypeLogPanel {...props} entries={[entry]}/>);
  const list=screen.getByRole('list',{name:'Test log events'});Object.defineProperty(list,'scrollHeight',{configurable:true,value:1000});
  const panel=screen.getByText('Test log · 1 events').closest('details')!;
  panel.open=true;fireEvent(panel,new Event('toggle'));expect(list.scrollTop).toBe(1000);
  list.scrollTop=0;panel.open=false;fireEvent(panel,new Event('toggle'));panel.open=true;fireEvent(panel,new Event('toggle'));expect(list.scrollTop).toBe(1000);
  list.scrollTop=0;rerender(<PrototypeLogPanel {...props} entries={[entry,{...entry,id:'two',message:'Latest'}]}/>);expect(list.scrollTop).toBe(1000);
});

it('keeps completed uncaptained speech replayable and fills the same bubble when captions arrive',()=>{
  let callbacks:SessionControllerCallbacks={};const play=vi.fn(async(_output:unknown)=>undefined);
  render(<App createSessionController={cb=>{callbacks=cb;return {connect:async()=>undefined,sendText:()=>true,beginMicrophoneTurn:()=>1,sendMicrophoneAudio:()=>undefined,endMicrophoneStream:()=>undefined,stop:async()=>undefined};}} audioPlayer={{prepare:async()=>undefined,close:async()=>undefined,stop:()=>undefined,setMuted:()=>undefined,play}}/>);
  act(()=>callbacks.onRecordedOutput?.('uncaptained',{transcript:'',language:'en',audio:[{data:'AAAA',mimeType:'audio/pcm;rate=24000'}],verification:'not_required'}));
  expect(screen.getAllByRole('button',{name:'Replay audio'})).toHaveLength(1);
  act(()=>callbacks.onAssistantTranscript?.('Late complete caption','en',false,'uncaptained'));
  expect(screen.getByText('Late complete caption')).toBeInTheDocument();expect(screen.getAllByRole('button',{name:'Replay audio'})).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Replay audio'}));expect(play.mock.calls[0][0]).toMatchObject({audio:[{data:'AAAA'}]});
});

it("attaches audio received before a caption by output ID and replays only that immutable bubble", async () => {
  let callbacks: SessionControllerCallbacks = {};
  const play = vi.fn(async (_output: unknown) => undefined);
  render(<App createSessionController={(cb) => { callbacks = cb; return { connect: async () => undefined, sendText: () => true, beginMicrophoneTurn: () => 1, sendMicrophoneAudio: () => undefined, endMicrophoneStream: () => undefined, stop: async () => undefined }; }} audioPlayer={{ prepare: async () => undefined, close: async () => undefined, stop: () => undefined, setMuted: () => undefined, play }} />);
  const record = { transcript: "", language: "en" as const, audio: [{ data: "AAAA", mimeType: "audio/pcm;rate=24000" }], verification: "not_required" as const };
  act(() => {
    callbacks.onRecordedOutput?.("first", record);
    callbacks.onAssistantTranscript?.("First answer", "en", false, "first");
    callbacks.onAssistantTranscript?.("Second answer", "en", false, "second");
    callbacks.onRecordedOutput?.("second", { ...record, audio: [{ data: "BBBB", mimeType: "audio/pcm;rate=24000" }] });
  });
  record.audio[0].data = "changed outside";
  expect(screen.getAllByRole("button", { name: "Replay audio" })).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button", { name: "Replay audio" })[0]);
  expect(play.mock.calls[0][0]).toMatchObject({ transcript: "First answer", audio: [{ data: "AAAA" }] });
  expect(screen.getByText("First answer")).toBeInTheDocument();
  expect(screen.getByText("Second answer")).toBeInTheDocument();
});

it("completes a late caption in its original bubble while preserving its replay audio", () => {
  let callbacks: SessionControllerCallbacks = {};
  const play = vi.fn(async (_output: unknown) => undefined);
  render(<App createSessionController={(cb) => { callbacks = cb; return { connect: async () => undefined, sendText: () => true, beginMicrophoneTurn: () => 1, sendMicrophoneAudio: () => undefined, endMicrophoneStream: () => undefined, stop: async () => undefined }; }} audioPlayer={{ prepare: async () => undefined, close: async () => undefined, stop: () => undefined, setMuted: () => undefined, play }} />);
  act(() => {
    callbacks.onAssistantTranscript?.("Hello", "en", false, "same");
    callbacks.onRecordedOutput?.("same", { transcript: "Hello", language: "en", audio: [{ data: "AAAA", mimeType: "audio/pcm;rate=24000" }], verification: "not_required" });
    callbacks.onAssistantTranscript?.("Other reply", "en", false, "other");
    callbacks.onAssistantTranscript?.("Hello there", "en", false, "same");
  });
  expect(screen.getByText("Hello there")).toBeInTheDocument();
  expect(screen.getByText("2 messages")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Replay audio" }));
  expect(play.mock.calls[0][0]).toMatchObject({ transcript: "Hello there", audio: [{ data: "AAAA" }] });
});
