import { afterEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createReceptionTestDatabase } from "../helpers/receptionDatabase";
import { ReceptionService } from "../../src/server/reception/service";
import type { ReceptionCommand, ReceptionSnapshot } from "../../src/shared/reception";

const connections: Array<{ dispose: () => Promise<void> }> = [];
const clock = () => new Date("2026-10-03T05:00:00.000Z");
type TestDatabase = Pool & { prepare: (sql: string) => { all: (...values: unknown[]) => Promise<any[]>; get: (...values: unknown[]) => Promise<any>; run: (...values: unknown[]) => Promise<unknown> }; exec: (sql: string) => Promise<unknown> };
function testDatabase(pool: Pool): TestDatabase {
  const db=pool as TestDatabase;
  db.prepare=(sql:string)=>{
    const ignore=/^\s*INSERT OR IGNORE INTO /i.test(sql);
    let index=0;
    let statement=sql.replace(/\?/g,()=>`$${++index}`).replace(/^\s*INSERT OR IGNORE INTO /i,"INSERT INTO ");
    if(ignore&&!/ON CONFLICT/i.test(statement))statement += " ON CONFLICT DO NOTHING";
    return {
      all:async(...values:unknown[]) => (await pool.query(statement,values as any[])).rows,
      get:async(...values:unknown[]) => (await pool.query(statement,values as any[])).rows[0],
      run:async(...values:unknown[]) => pool.query(statement,values as any[]),
    };
  };
  db.exec=(sql:string)=>pool.query(sql);
  return db;
}
async function setup(testClock = clock) {
  const fixture = await createReceptionTestDatabase(); connections.push(fixture);
  const db = testDatabase(fixture.pool);
  const service = new ReceptionService(fixture.pool, { clock:testClock });
  let snapshot = await service.createSession("0501234567"); let sequence = 0, outputSequence = 0, mediaSequence = 0;
  let activeOutputId = "output-0";
  const command = async (tool: string, args: Record<string, unknown> = {}, overrides: Partial<ReceptionCommand> = {}) => {
    sequence++;
    const request: ReceptionCommand = { eventId: `event-${sequence}`, expectedVersion: snapshot.version, tool, args,
      context: { connectionId: "connection", inputTurnId: `input-${sequence}`, inputSequence: sequence,
        eventSequence: sequence * 10, inputStartedEventSequence: sequence * 10 - 1,
        source: "text", attribution: "known", outputId: activeOutputId }, ...overrides };
    const result = await service.execute(snapshot.sessionId, request); snapshot = result.snapshot;
    return { ...result, request };
  };
  const expose = async (offers = snapshot.offers) => {
    const outputId = activeOutputId = `output-${++outputSequence}`;
    await service.recordMediaEvent(snapshot.sessionId, { eventId: `media-${++mediaSequence}`, connectionId: "connection", outputId, inputSequence: sequence,
      eventSequence: sequence * 10 + 1, medium: "audio", exposure: "started", offerIds: offers.map(o => o.offerId) });
    return outputId;
  };
  const assistantOutput = async () => {
    const outputId = activeOutputId = `output-${++outputSequence}`;
    await service.recordMediaEvent(snapshot.sessionId, { eventId: `media-${++mediaSequence}`, connectionId: "connection", outputId, inputSequence: sequence,
      eventSequence: sequence * 10 + 2, medium: "text", exposure: "started", offerIds: [] });
    return outputId;
  };
  const prepare = async (doctorIdentifier = "doc-001") => {
    await command("set_booking_details", { patientName: "Test Caller" });
    await command("find_available_slots", { doctorIdentifier, dateExpression:"tomorrow", exactTime:"09:00" }); await expose();
    return command("accept_offer", { offerId: snapshot.offers[0].offerId, decision: "accept", detailsCommunicated: true });
  };
  return { db, service, command, expose, assistantOutput, prepare, snapshot: () => snapshot };
}
afterEach(async () => { await Promise.all(connections.splice(0).map(fixture=>fixture.dispose())); });
const count = async (db: Pool, table: string) => Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
const realPostgresUrl = process.env.TEST_POSTGRES_URL?.trim();

describe("resource reception", () => {
  it('refreshes restored offer labels across Riyadh midnight without changing the saved offer',async ()=>{
    let now=new Date('2026-10-03T20:59:00Z');const f= (await setup(()=>now));
     (await f.command('find_available_slots',{doctorIdentifier:'doc-001',date:'2026-10-04',exactTime:'09:00'}));
    const stored= (await (await f.db.prepare('SELECT data FROM reception_offers')).all());
    expect((f.snapshot().offers[0].labels.en as any).relativeDays).toBe(1);
    now=new Date('2026-10-03T21:01:00Z');
    const restored= (await f.service.getSnapshot(f.snapshot().sessionId))!;
    expect((restored.offers[0].labels.en as any).relativeDateTime).toBe('today at 9:00');
    expect(restored.version).toBe(f.snapshot().version);expect( (await (await f.db.prepare('SELECT data FROM reception_offers')).all())).toEqual(stored);
  });
  it('projects fresh Riyadh labels for lookup, selection and recovered results without rewriting storage',async ()=>{
    let now=new Date('2026-10-03T05:00:00Z');const f= (await setup(()=>now));
     (await f.command('set_booking_details',{patientName:'Ahmed'}));
     (await f.command('find_available_slots',{doctorIdentifier:'doc-001',date:'2026-10-04',exactTime:'09:00'})); (await f.expose());
    const ready= (await f.command('accept_offer',{offerId:f.snapshot().offers[0].offerId,decision:'accept',detailsCommunicated:true}));
    const saved= (await f.command('commit_request',{operationId:ready.operationId}));
    const before= (await (await f.db.prepare('SELECT * FROM reception_appointments')).get());
    const operationBefore= (await (await f.db.prepare('SELECT result FROM reception_operations WHERE id=?')).get(ready.operationId));
    expect(saved.result).toMatchObject({startsAtUtc:'2026-10-04T06:00:00.000Z',labels:{en:{relativeDays:1,relativeDateTime:'tomorrow at 9:00'}}});
    const fresh= (await f.service.createSession('0501234567'));
    const call=async (tool:string,args:Record<string,unknown>,sequence:number)=> (await f.service.execute(fresh.sessionId,{eventId:`fresh-${sequence}`,expectedVersion: (await f.service.getSnapshot(fresh.sessionId))!.version,tool,args,context:{connectionId:'fresh',inputTurnId:`fresh-${sequence}`,inputSequence:sequence,eventSequence:sequence,inputStartedEventSequence:sequence,source:'text',attribution:'known'}}));
    const lookup= (await call('find_my_appointments',{},1));const appointment=(lookup.facts!.appointments as any[])[0];
    expect(appointment.labels.en.spokenDateTime).toContain('4 October');expect(appointment.labels.en.spokenDateTime).toContain('9:00');
    expect(appointment.labels.ar.spokenHijriDateTime).toBeTruthy();
    expect( (await call('select_appointment',{appointmentId:appointment.appointmentId,action:'reschedule'},2)).facts!.appointment).toMatchObject({labels:appointment.labels});
    now=new Date('2026-10-04T05:00:00Z');
    expect( (await f.command('get_operation',{operationId:ready.operationId})).result).toMatchObject({labels:{en:{relativeDays:0,relativeDateTime:'today at 9:00'}}});
    expect( (await f.service.getSnapshot(f.snapshot().sessionId))!.operations[0].result).toMatchObject({labels:{en:{relativeDays:0}}});
    expect( (await f.service.getEvent(f.snapshot().sessionId,saved.request.eventId))).toMatchObject({result:{labels:{en:{relativeDays:0}}}});
    expect( (await (await f.db.prepare('SELECT * FROM reception_appointments')).get())).toEqual(before);
    expect( (await (await f.db.prepare('SELECT result FROM reception_operations WHERE id=?')).get(ready.operationId))).toEqual(operationBefore);
  });
  it('rejects old lookup candidates after contact changes',async ()=>{
    const f= (await setup());const ready= (await f.prepare());const saved= (await f.command('commit_request',{operationId:ready.operationId}));
     (await f.command('find_my_appointments'));
     (await f.command('capture_contact',{mode:'replace',rawText:'0555555555'}));
     (await f.command('confirm_contact',{contactVersion:f.snapshot().contact.version,decision:'accept'}));
    expect( (await f.command('select_appointment',{appointmentId:saved.result!.appointmentId,action:'cancel'})).status).toBe('not_found');
    expect( (await f.service.activity()).appointments[0].status).toBe('active');
  });
  it('clears the previous subject service selection while retaining household contact',async ()=>{
    const f= (await setup()); (await f.command('find_available_slots',{doctorIdentifier:'doc-001',serviceId:'extended_consultation'}));
     (await f.command('set_booking_details',{newSubject:true,patientName:'Another Synthetic'}));
    expect(f.snapshot().draft?.serviceId).toBeUndefined();expect(f.snapshot().draft?.doctorId).toBeUndefined();
    expect(f.snapshot().contact.digits).toBe('0501234567');
  });
  it("requests repair before confirmation of incomplete contact and keeps accepted offer", async () => {
    const f= (await setup());  (await f.command("capture_contact",{mode:"replace",rawText:"133"}));
    const acceptedResult= (await f.prepare());
    expect(acceptedResult).toMatchObject({status:"invalid_contact",facts:{offerAccepted:true,bookingStatus:"not_booked",appointmentSaved:false,slotReserved:false,capacityHeld:false,requiredFunction:"capture_contact"}});
    expect(acceptedResult.operationId).toBeUndefined();
    expect( (await count(f.db,"reception_appointments"))).toBe(0);expect( (await count(f.db,"reception_effects"))).toBe(0);
    const accepted=f.snapshot().draft?.acceptedOfferId;
    const partial= (await f.command("capture_contact",{mode:"replace",rawText:"133"}));
    expect(partial).toMatchObject({status:"invalid_contact",facts:{digitCount:3,expectedDigitCount:10,confirmationRequired:false,requiredFunction:"capture_contact"}});
    const missing= (await f.command("commit_request",{operationId:"not-issued"}));
    expect(missing.facts?.requiredFunction).toBe("capture_contact");
    expect(f.snapshot().draft?.acceptedOfferId).toBe(accepted);
    const complete= (await f.command("capture_contact",{mode:"replace",rawText:"0501234567"}));
    expect(complete.facts).toMatchObject({confirmationRequired:true,requiredFunction:"confirm_contact"});
    const ready= (await f.command("confirm_contact",{contactVersion:f.snapshot().contact.version,decision:"accept"}));
    expect(ready).toMatchObject({status:"ready",facts:{offerAccepted:true,bookingStatus:"not_booked",appointmentSaved:false,slotReserved:false,capacityHeld:false,requiredFunction:"commit_request"}});
    expect(f.snapshot().draft?.acceptedOfferId).toBe(accepted);
    expect( (await count(f.db,"reception_appointments"))).toBe(0);expect( (await count(f.db,"reception_effects"))).toBe(0);
    expect( (await f.command("commit_request",{operationId:ready.operationId})).status).toBe("committed");
    expect( (await count(f.db,"reception_appointments"))).toBe(1);expect( (await count(f.db,"reception_effects"))).toBe(1);
  });
  it("explains same-turn contact rejection and preserves accepted offer during an unissued-operation repair",async ()=>{
    const f= (await setup()); (await f.command('capture_contact',{mode:'restart'})); (await f.prepare());
    const captured= (await f.command('capture_contact',{mode:'replace',rawText:'0501234567'}));
    const acceptedOfferId=f.snapshot().draft?.acceptedOfferId;
    const rejected= (await f.command('confirm_contact',{contactVersion:f.snapshot().contact.version,decision:'accept'},{context:captured.request.context}));
    expect(rejected.facts).toMatchObject({confirmed:false,contactVersion:3,requiredFunction:'confirm_contact'});
    const unissued= (await f.command('commit_request',{operationId:'invented'}));
    expect(unissued.missingFields).toContain('confirmed_contact');expect(unissued.facts?.acceptedOfferId).toBe(acceptedOfferId);
    const confirmed= (await f.command('confirm_contact',{contactVersion:f.snapshot().contact.version,decision:'accept'}));
    expect(confirmed.status).toBe('ready');expect(f.snapshot().draft?.acceptedOfferId).toBe(acceptedOfferId);
  });
  it("returns unknown monetary consequence and unchanged appointment for a cancellation offer",async ()=>{
    const f= (await setup()); (await f.command("set_booking_details",{patientName:"Test Caller"})); (await f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-03",exactTime:"09:00"})); (await f.expose());const ready= (await f.command("accept_offer",{offerId:f.snapshot().offers[0].offerId,decision:"accept",detailsCommunicated:true}));const saved= (await f.command('commit_request',{operationId:ready.operationId}));
     (await f.command('find_my_appointments'));const offer= (await f.command('select_appointment',{appointmentId:saved.result?.appointmentId,action:'cancel'}));
    expect(offer.facts).toMatchObject({appointmentUnchanged:true,policy:{financialPenalty:'unknown',classification:'late_no_show'}});
    expect( (await f.service.activity()).appointments[0].status).toBe('active');
  });
  it("returns grounded directory facts without identity intake and injected Riyadh dates", async () => {
    const f =  (await setup()); const result =  (await f.command("clinic_information", {}));
    expect(result.snapshot.directory).toHaveLength(30); expect(result.snapshot.clock.localDate).toBe("2026-10-03");
    expect(result.snapshot.draft).toBeUndefined(); expect( (await f.command("clinic_information", {query: "unknown-price"})).status).toBe("unknown");
  });
  it("accepts one presented opening and commits exactly one atomic appointment and simulated effect", async () => {
    const f =  (await setup()); const ready =  (await f.prepare()); expect(ready.status).toBe("ready");
    const committed =  (await f.command("commit_request", {operationId: ready.operationId})); expect(committed.status).toBe("committed");
    expect( (await count(f.db, "reception_appointments"))).toBe(1); expect( (await count(f.db, "reception_effects"))).toBe(1);
    expect( (await count(f.db, "reception_occupancy"))).toBe(2);
    expect( (await f.service.execute(f.snapshot().sessionId, committed.request))).toMatchObject({status: "committed", operationId: ready.operationId});
    expect( (await f.command("commit_request", {operationId: ready.operationId}, {expectedVersion: 0})).status).toBe("committed");
    expect( (await count(f.db, "reception_appointments"))).toBe(1);
  });
  // PGlite's pg-gateway test emulator loses savepoint-scoped rows across two
  // concurrent protocol clients; run this acceptance only against real Postgres.
  it.skipIf(!realPostgresUrl)("allows only one of two simultaneous sessions to claim the final capacity without loser records", async () => {
    let occupancyArrivals = 0;
    let releaseOccupancy!: () => void;
    const occupancyBarrier = new Promise<void>(resolve => { releaseOccupancy = resolve; });
    const fixture = await createReceptionTestDatabase({
      connectionString: realPostgresUrl!,
      maxConnections: 4,
      beforeQuery: async sql => {
        if (!/^INSERT INTO reception_occupancy\b/i.test(sql)) return;
        occupancyArrivals++;
        if (occupancyArrivals === 2) releaseOccupancy();
        await occupancyBarrier;
      },
    });
    connections.push(fixture);
    const service = new ReceptionService(fixture.pool, { clock });
    const prepareCaller = async (phone: string, name: string) => {
      let snapshot = await service.createSession(phone);
      const run = async (tool: string, args: Record<string, unknown>, sequence: number, outputId?: string) => {
        const result = await service.execute(snapshot.sessionId, {
          eventId: `${snapshot.sessionId}-${sequence}`,
          expectedVersion: snapshot.version,
          tool,
          args,
          context: {
            connectionId: snapshot.sessionId,
            inputTurnId: `${snapshot.sessionId}-turn-${sequence}`,
            inputSequence: sequence,
            eventSequence: sequence * 10,
            inputStartedEventSequence: sequence * 10 - 1,
            source: "text",
            attribution: "known",
            ...(outputId ? { outputId } : {}),
          },
        });
        snapshot = result.snapshot;
        return result;
      };

      await run("set_booking_details", { patientName: name }, 1);
      const lookup = await run("find_available_slots", { doctorIdentifier: "doc-001", date: "2026-10-04", exactTime: "09:00" }, 2);
      const offer = lookup.snapshot.offers[0]!;
      const outputId = `${snapshot.sessionId}-offer`;
      await service.recordMediaEvent(snapshot.sessionId, {
        eventId: `${snapshot.sessionId}-exposure`, connectionId: snapshot.sessionId, outputId,
        inputSequence: 2, eventSequence: 21, medium: "text", exposure: "started", offerIds: [offer.offerId],
      });
      const ready = await run("accept_offer", { offerId: offer.offerId, decision: "accept", detailsCommunicated: true }, 3, outputId);
      expect(ready.status).toBe("ready");
      return { snapshot, operationId: ready.operationId! };
    };

    const first = await prepareCaller("0501234567", "First Caller");
    const second = await prepareCaller("0551234567", "Second Caller");
    const commit = (caller: typeof first, sequence: number) => service.execute(caller.snapshot.sessionId, {
      eventId: `${caller.snapshot.sessionId}-commit`,
      expectedVersion: caller.snapshot.version,
      tool: "commit_request",
      args: { operationId: caller.operationId },
      context: {
        connectionId: caller.snapshot.sessionId,
        inputTurnId: `${caller.snapshot.sessionId}-commit-turn`,
        inputSequence: sequence,
        eventSequence: sequence * 10,
        inputStartedEventSequence: sequence * 10 - 1,
        source: "text",
        attribution: "known",
      },
    });
    const outcomes = await Promise.all([commit(first, 4), commit(second, 4)]);

    expect(occupancyArrivals).toBe(2);
    expect(outcomes.filter(outcome => outcome.status === "committed")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected" && outcome.result?.issue === "capacity_conflict")).toHaveLength(1);
    expect(await count(fixture.pool, "reception_appointments")).toBe(1);
    expect(await count(fixture.pool, "reception_subjects")).toBe(1);
    expect(await count(fixture.pool, "reception_occupancy")).toBe(2);
    expect(await count(fixture.pool, "reception_history")).toBe(1);
    expect(await count(fixture.pool, "reception_effects")).toBe(1);
    expect((await fixture.pool.query("SELECT status FROM reception_operations ORDER BY seq")).rows.map(row => row.status).sort()).toEqual(["committed", "rejected"]);
  });
  it("refuses unseen or same-turn approval and uncertain attribution", async () => {
    const f =  (await setup());  (await f.command("find_available_slots", {doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"09:00"}));
    const args = {offerId:f.snapshot().offers[0].offerId, decision:"accept",detailsCommunicated:true};
    expect( (await f.command("accept_offer",args)).status).toBe("needs_clarification");  (await f.expose());
    expect( (await f.command("accept_offer",args,{context:{connectionId:"connection",inputTurnId:"uncertain",inputSequence:8,eventSequence:80,inputStartedEventSequence:79,source:"microphone",attribution:"uncertain",outputId:"output"}})).status).toBe("needs_clarification");
    expect( (await count(f.db,"reception_appointments"))).toBe(0);
  });
  it("does not treat a different intervening assistant output as presentation of the same offer", async () => {
    const f= (await setup()); (await f.command("set_booking_details",{patientName:"Test Caller"})); (await f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"09:00"}));
    const offer=f.snapshot().offers[0];const presentedOutput= (await f.expose());const interveningOutput= (await f.assistantOutput());
    expect(interveningOutput).not.toBe(presentedOutput);
    const rejected= (await f.command("accept_offer",{offerId:offer.offerId,decision:"accept",detailsCommunicated:true}));
    expect(rejected).toMatchObject({status:"needs_clarification",issues:["offer_requires_presented_details_and_subsequent_known_turn"]});
    expect(rejected.facts).toMatchObject({offerAccepted:false,bookingStatus:"not_booked",appointmentSaved:false,slotReserved:false});
    expect(f.snapshot().draft?.acceptedOfferId).toBeUndefined();expect( (await count(f.db,"reception_appointments"))).toBe(0);expect( (await count(f.db,"reception_effects"))).toBe(0);
  });
  it("preserves accepted selection through contact repair and same-subject name changes", async () => {
    const f =  (await setup());  (await f.command("capture_contact",{mode:"replace",rawText:"050"})); const prepared= (await f.prepare());
    expect(prepared.status).toBe("invalid_contact"); const offerId=f.snapshot().draft?.acceptedOfferId;
     (await f.command("capture_contact",{mode:"append",rawText:"1234567"}));
    expect(f.snapshot().draft?.acceptedOfferId).toBe(offerId);
    const confirmation= (await f.command("confirm_contact",{contactVersion:f.snapshot().contact.version,decision:"accept"}));
    expect(confirmation.status).toBe("ready");  (await f.command("set_booking_details",{patientName:"Corrected Name"}));
    expect(f.snapshot().draft?.acceptedOfferId).toBe(offerId);
    const committed= (await f.command("commit_request",{operationId:f.snapshot().draft?.operationId}));
    expect(committed.status).toBe("committed"); expect(committed.result?.patientName).toBe("Corrected Name");
  });
  it("deduplicates contact events before stale versions and rejects changed payload", async () => {
    const f= (await setup()); const result= (await f.command("capture_contact",{mode:"replace",rawText:"050"}));
    expect( (await f.service.execute(f.snapshot().sessionId,result.request)).snapshot.contact.digits).toBe("050");
    expect( (await f.service.execute(f.snapshot().sessionId,{...result.request,args:{mode:"append",rawText:"9"}})).status).toBe("conflict");
  });
  it("serializes close and emergency against pending commits while preserving committed recovery", async () => {
    const f= (await setup()); const ready= (await f.prepare()); const id=f.snapshot().sessionId;
    expect((await f.service.closeSession(id,{eventId:"close",expectedVersion:f.snapshot().version,outcome:"declined"})).status).toBe("closed");
    expect( (await f.command("commit_request",{operationId:ready.operationId})).status).not.toBe("committed"); expect( (await count(f.db,"reception_appointments"))).toBe(0);
    const g= (await setup()); const ready2= (await g.prepare());  (await g.command("set_emergency",{active:true}));
    expect( (await g.command("commit_request",{operationId:ready2.operationId})).status).not.toBe("committed");
    expect( (await g.command("set_emergency",{active:false})).snapshot.patientName).toBe("Test Caller");
    expect(g.snapshot().draft?.acceptedOfferId).toBeUndefined();
  });
  it("returns earliest openings inside an explicit window with duration capacity", async () => {
    const f= (await setup()); const result= (await f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04",fromTime:"10:15",toTime:"11:00"}));
    expect(result.status).toBe("availability");expect(result.facts?.availabilityWindows).toMatchObject([{date:"2026-10-04",startTime:"10:15",lastStartTime:"10:45",stepMinutes:15,serviceDurationMinutes:30}]);
    expect(result.facts?.offers).toBeUndefined();expect(result.snapshot.offers).toEqual([]);
    expect( (await f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"next special holiday"})).status).toBe("needs_clarification");
  });
  it("returns appointment-start windows split around an occupied booking instead of offering an unchosen time",async ()=>{
    const f= (await setup()); (await f.command("set_booking_details",{patientName:"Existing Patient"}));
     (await f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04",exactTime:"12:00"}));
    const occupiedOffer=f.snapshot().offers[0]; (await f.expose());
    const accepted= (await f.command("accept_offer",{offerId:occupiedOffer.offerId,decision:"accept",detailsCommunicated:true}));
    expect(accepted.status).toBe("ready");
    expect( (await f.command("commit_request",{operationId:accepted.operationId})).status).toBe("committed");

    const result= (await f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04"}));
    expect(result.status).toBe("availability");
    expect(result.facts?.availabilityWindows).toMatchObject([
      {date:"2026-10-04",startTime:"09:00",lastStartTime:"11:30",stepMinutes:15,serviceDurationMinutes:30},
      {date:"2026-10-04",startTime:"12:30",lastStartTime:"16:30",stepMinutes:15,serviceDurationMinutes:30},
    ]);
    expect((result.facts?.availabilityWindows as any[])[0].timeLabels.ar).toMatchObject({startTime:"٩:٠٠ صباحًا",lastStartTime:"١١:٣٠ صباحًا"});
    expect(result.facts?.offers).toBeUndefined();
    expect(result.snapshot.offers).toEqual([]);
    expect( (await count(f.db,"reception_appointments"))).toBe(1);

    const selected= (await f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04",exactTime:"12:30"}));
    expect(selected.status).toBe("offers");expect(selected.facts?.offers).toMatchObject([{startsAtUtc:"2026-10-04T09:30:00.000Z"}]);
    expect( (await count(f.db,"reception_appointments"))).toBe(1);
  });
  it.each([
    ["omitted date",{}],
    ["multi-day explicit range",{fromDate:"2026-10-04",toDate:"2026-10-06"}],
    ["multi-day relative range",{dateExpression:"next week"}],
  ] as const)("requires one specific date for exact-time searches with a %s",async (_case,dateArgs)=>{
    const f= (await setup());
    const result= (await f.command("find_available_slots",{doctorIdentifier:"doc-001",exactTime:"09:00",...dateArgs}));
    expect(result).toMatchObject({status:"needs_clarification",issues:["exact_time_requires_single_date"]});
    expect(result.snapshot.offers).toEqual([]);
    expect( (await count(f.db,"reception_offers"))).toBe(0);
    expect( (await count(f.db,"reception_appointments"))).toBe(0);
  });
  it("stores a broad synthetic schedule but never offers a persisted past opening",async ()=>{
    const f= (await setup(()=>new Date("2026-10-04T09:30:00.000Z")));
    const past= (await f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04",exactTime:"09:00"}));
    expect(past.status).toBe("unavailable");
    expect( (await (await f.db.prepare("SELECT id FROM reception_capacity WHERE doctor_id='doc-001' AND starts_at_utc='2026-10-04T06:00:00.000Z'")).get())).toBeTruthy();
    expect( (await count(f.db,"reception_capacity"))).toBe(31*32);

    const current= (await f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04"}));
    expect(current.status).toBe("availability");
    expect((current.facts?.availabilityWindows as any[]).map(window=>window.startTime)).toEqual(["13:30"]);
    expect(current.snapshot.offers).toEqual([]);
    expect( (await count(f.db,"reception_appointments"))).toBe(0);
  });
  it.each([
    ["unclear answer","unclear",true],
    ["qualified yes asking for a later time","change",false],
    ["clear decline","decline",false],
  ] as const)("does not accept an offer after a %s",async (_case,decision,offerRetained)=>{
    const f= (await setup()); (await f.command("set_booking_details",{patientName:"Test Caller"}));
     (await f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04",exactTime:"09:00"})); (await f.expose());
    const offerId=f.snapshot().offers[0].offerId;
    const result= (await f.command("accept_offer",{offerId,decision,detailsCommunicated:true}));
    expect(result.status).toBe("needs_clarification");
    expect(Boolean(f.snapshot().offers.find(offer=>offer.offerId===offerId))).toBe(offerRetained);
    expect(f.snapshot().draft?.acceptedOfferId).toBeUndefined();
    expect( (await count(f.db,"reception_appointments"))).toBe(0);expect( (await count(f.db,"reception_effects"))).toBe(0);expect( (await count(f.db,"reception_occupancy"))).toBe(0);
  });
  it("rejects a ready booking when the caller changes the selected doctor and time",async ()=>{
    const f= (await setup()); (await f.command("set_booking_details",{patientName:"Test Caller"}));
     (await f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04",exactTime:"09:00"})); (await f.expose());
    const ready= (await f.command("accept_offer",{offerId:f.snapshot().offers[0].offerId,decision:"accept",detailsCommunicated:true}));
    expect(ready.status).toBe("ready");
     (await f.command("find_available_slots",{doctorIdentifier:"doc-002",date:"2026-10-04",exactTime:"10:30"}));
    expect( (await f.command("commit_request",{operationId:ready.operationId}))).toMatchObject({status:"rejected",result:{issue:"superseded"}});
    expect( (await count(f.db,"reception_appointments"))).toBe(0);expect( (await count(f.db,"reception_effects"))).toBe(0);expect( (await count(f.db,"reception_occupancy"))).toBe(0);
  });
  it("rolls back appointment and occupancy when persistence fails", async () => {
    const f= (await setup()); const ready= (await f.prepare());
    await f.db.query("ALTER TABLE reception_effects ADD CONSTRAINT fail_effect CHECK (kind <> 'notification')");
    const failed= (await f.command("commit_request",{operationId:ready.operationId}));expect(failed.status).toBe("error");
    expect( (await f.service.getEvent(f.snapshot().sessionId,failed.request.eventId))?.status).toBe("unresolved");
    expect( (await count(f.db,"reception_appointments"))).toBe(0); expect( (await count(f.db,"reception_occupancy"))).toBe(0);
    await f.db.query("ALTER TABLE reception_effects DROP CONSTRAINT fail_effect");
    expect( (await f.service.execute(f.snapshot().sessionId,failed.request)).status).toBe("committed");
  });
  it("retrieves committed results after a database restart and a subsequent close", async () => {
    const f= (await setup()); const ready= (await f.prepare()); const committed= (await f.command("commit_request",{operationId:ready.operationId})); const id=f.snapshot().sessionId;
    const service=new ReceptionService(f.db,{clock});
    await service.closeSession(id,{eventId:"close-after-restart",expectedVersion:(await service.getSnapshot(id))!.version,outcome:"completed"});
    expect(await service.execute(id,committed.request)).toMatchObject({status:"committed",result:{appointmentId:committed.result?.appointmentId}});
    expect(await service.getEvent(id,committed.request.eventId)).toMatchObject({status:"committed"}); expect(await count(f.db,"reception_appointments")).toBe(1);
  });
  it("requires actual exposure preceding caller onset even for completed and muted output", async () => {
    const f= (await setup()); (await f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"09:00"}));const offerId=f.snapshot().offers[0].offerId;
     (await f.service.recordMediaEvent(f.snapshot().sessionId,{eventId:"muted",connectionId:"connection",outputId:"muted",inputSequence:1,eventSequence:11,medium:"audio",exposure:"not_started",offerIds:[offerId]}));
    const args={offerId,decision:"accept",detailsCommunicated:true};
    expect( (await f.command("accept_offer",args,{context:{connectionId:"connection",inputTurnId:"input2",inputSequence:2,eventSequence:20,inputStartedEventSequence:19,source:"microphone",attribution:"known",outputId:"muted"}})).status).toBe("needs_clarification");
     (await f.service.recordMediaEvent(f.snapshot().sessionId,{eventId:"late-exposure",connectionId:"connection",outputId:"late",inputSequence:2,eventSequence:35,medium:"text",exposure:"completed",offerIds:[offerId]}));
    expect( (await f.command("accept_offer",args,{context:{connectionId:"connection",inputTurnId:"input3",inputSequence:3,eventSequence:40,inputStartedEventSequence:30,source:"text",attribution:"known",outputId:"late"}})).status).toBe("needs_clarification");
  });
  it("keeps shared household contact separate from patient identity and preserves partial family success", async () => {
    const f= (await setup());const ready= (await f.prepare()); (await f.command("commit_request",{operationId:ready.operationId}));
     (await f.command("set_booking_details",{newSubject:true,patientName:"Family Member",callerName:"Test Caller",relationship:"sibling"}));expect(f.snapshot().contact.digits).toBe("0501234567");expect(f.snapshot().contact.confirmedVersion).toBe(f.snapshot().contact.version);expect(f.snapshot().callingNumber).toBe("0501234567");
     (await f.command("find_available_slots",{doctorIdentifier:"doc-002",dateExpression:"tomorrow",exactTime:"09:30"})); (await f.expose());const second= (await f.command("accept_offer",{offerId:f.snapshot().offers[0].offerId,decision:"accept",detailsCommunicated:true}));
    expect( (await f.command("commit_request",{operationId:second.operationId})).status).toBe("committed");expect( (await count(f.db,"reception_subjects"))).toBe(2);
    const lookup= (await f.command("find_my_appointments",{}));expect(lookup.status).toBe("ambiguous");expect((lookup.facts?.appointments as unknown[])).toHaveLength(2);
     (await f.command("set_booking_details",{newSubject:true,patientName:"Third Member"})); (await f.command("capture_contact",{mode:"replace",rawText:"050"}));expect( (await f.command("record_followup",{kind:"callback"})).status).toBe("invalid_contact");expect( (await count(f.db,"reception_appointments"))).toBe(2);
  });
  it("preserves appointment identity and old occupancy on a conflicting reschedule", async () => {
    const f= (await setup());const first= (await f.prepare());const committed= (await f.command("commit_request",{operationId:first.operationId}));const id=String(committed.result?.appointmentId);const oldSlots=(committed.result?.slotIds as string[]);
     (await f.command("find_my_appointments",{})); (await f.command("select_appointment",{appointmentId:id,action:"reschedule"})); (await f.command("find_available_slots",{doctorIdentifier:"doc-002",dateExpression:"tomorrow",exactTime:"09:30"}));const offer=f.snapshot().offers[0]; (await f.expose());const ready= (await f.command("accept_offer",{offerId:offer.offerId,decision:"accept",detailsCommunicated:true}));
     (await (await f.db.prepare("INSERT INTO reception_appointments (id,subject_id,doctor_id,service_id,starts_at_utc,version,status,classification,data) SELECT ?,subject_id,doctor_id,service_id,starts_at_utc,version,status,classification,data FROM reception_appointments WHERE id=?")).run("competing-appointment",id));
     (await (await f.db.prepare("INSERT INTO reception_occupancy VALUES (?,?)")).run(offer.slotIds[0],"competing-appointment"));
    expect( (await f.command("commit_request",{operationId:ready.operationId}))).toMatchObject({status:"rejected",result:{issue:"capacity_conflict"}});
    expect(( (await (await f.db.prepare("SELECT slot_id FROM reception_occupancy WHERE appointment_id=? ORDER BY slot_id")).all(id)) as {slot_id:string}[]).map(r=>r.slot_id)).toEqual([...oldSlots].sort());
     (await f.command("find_available_slots",{doctorIdentifier:"doc-003",dateExpression:"tomorrow",exactTime:"09:30"})); (await f.expose());const retry= (await f.command("accept_offer",{offerId:f.snapshot().offers[0].offerId,decision:"accept",detailsCommunicated:true}));
    expect( (await f.command("commit_request",{operationId:retry.operationId})).result).toMatchObject({appointmentId:id,doctorId:"doc-003",version:2});
  });
  it("saves followup once, recovers by event ID and distinguishes admitted unresolved events", async () => {
    const f= (await setup()); (await f.command("set_booking_details",{patientName:"Callback Caller"}));const result= (await f.command("record_followup",{kind:"callback",reason:"hours question"}));
    expect(result.status).toBe("committed");expect( (await f.service.execute(f.snapshot().sessionId,result.request)).status).toBe("committed");expect( (await count(f.db,"reception_effects"))).toBe(1);
    expect( (await f.service.getEvent(f.snapshot().sessionId,result.request.eventId))).toMatchObject({status:"committed",result:{simulated:true,delivered:false}});
    expect( (await f.service.getEvent(f.snapshot().sessionId,"never-admitted"))?.status).toBe("not_found");
     (await (await f.db.prepare("INSERT INTO reception_events VALUES (?,?,?,NULL)")).run(f.snapshot().sessionId,"admitted","fingerprint"));expect( (await f.service.getEvent(f.snapshot().sessionId,"admitted"))?.status).toBe("unresolved");
    expect( (await f.command("record_followup",{kind:"waitlist"})).status).toBe("needs_details"); (await f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"23:00"}));
    expect( (await f.command("record_followup",{kind:"waitlist"})).result).toMatchObject({simulated:true,booked:false,preferences:{doctorId:"doc-001",exactTime:"23:00"}});
  });
  it("does not treat an explicit new lookup phone as already confirmed", async () => {
    const f= (await setup());expect( (await f.command("find_my_appointments",{phone:"0509876543"})).status).toBe("needs_details");expect(f.snapshot().contact.confirmedVersion).toBeUndefined();
    expect( (await f.command("find_my_appointments",{phone:"123"})).status).toBe("invalid_contact");
  });
  it("collects session contact/name for a callback without creating a booking draft",async ()=>{
    const f= (await setup()); (await f.command("set_booking_details",{patientName:"Callback Caller"}));expect(f.snapshot().draft).toBeUndefined();
    expect( (await f.command("record_followup",{kind:"callback"})).status).toBe("committed");expect( (await count(f.db,"reception_appointments"))).toBe(0);
  });
  it("retains committed results after an emergency and cannot close a paused session late",async ()=>{
    const f= (await setup());const ready= (await f.prepare()); (await f.command("commit_request",{operationId:ready.operationId})); (await f.command("set_emergency",{active:true}));
    expect( (await f.command("get_operation",{operationId:ready.operationId})).status).toBe("committed");
    expect((await f.service.closeSession(f.snapshot().sessionId,{eventId:"emergency-close",expectedVersion:f.snapshot().version,outcome:"emergency"})).status).toBe("closed");expect( (await count(f.db,"reception_appointments"))).toBe(1);
  });
  it("preserves consent when malformed semantic decisions arrive",async ()=>{
    const f= (await setup()); (await f.prepare());const old=f.snapshot().draft?.acceptedOfferId;
    expect( (await f.command("accept_offer",{offerId:old,decision:"nonsense",detailsCommunicated:true})).status).toBe("needs_clarification");expect(f.snapshot().draft?.acceptedOfferId).toBe(old);
  });
  it("resolves relative/Hijri dates and updates clock context across Riyadh midnight and year rollover",async ()=>{
    const f= (await setup());expect( (await f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"1448-04-23",calendar:"hijri",exactTime:"09:00"})).snapshot.offers[0].startsAtUtc).toBe("2026-10-04T06:00:00.000Z");
    let now=new Date("2026-12-31T20:59:00Z");const g= (await setup(()=>now));expect(g.snapshot().clock.localDate).toBe("2026-12-31");
    now=new Date("2026-12-31T21:01:00Z");expect( (await g.service.getSnapshot(g.snapshot().sessionId))?.clock.localDate).toBe("2027-01-01");
    expect( (await g.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"09:00"})).snapshot.offers[0].startsAtUtc).toBe("2027-01-02T06:00:00.000Z");
  });
  it.each([
    ["next week","2026-10-04","2026-10-11"],
    ["الأسبوع الجاي","2026-10-04","2026-10-11"],
    ["الأسبوع القادم","2026-10-04","2026-10-11"],
    ["in two weeks","2026-10-17","2026-10-24"],
    ["بعد اسبوعين","2026-10-17","2026-10-24"],
    ["بعد أسبوعين","2026-10-17","2026-10-24"],
    ["earliest","2026-10-03","2026-11-03"],
    ["أقرب موعد","2026-10-03","2026-11-03"],
  ])("resolves %s as the complete local window %s through %s",async (dateExpression,fromDate,toDate)=>{
    const f= (await setup());const result= (await f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression}));
    expect(result.status).toBe("availability");expect(result.facts?.window).toEqual({fromDate,toDate});
    expect((result.facts?.availabilityWindows as any[])[0].date).toBe(fromDate);expect(result.snapshot.offers).toEqual([]);
  });
  it("searches later in next week when the first date has no remaining capacity",async ()=>{
    const f= (await setup());const ready= (await f.prepare());const booked= (await f.command("commit_request",{operationId:ready.operationId}));
     (await (await f.db.prepare("INSERT OR IGNORE INTO reception_occupancy SELECT id,? FROM reception_capacity WHERE doctor_id='doc-001' AND starts_at_utc >= '2026-10-04T06:00:00.000Z' AND starts_at_utc < '2026-10-04T14:00:00.000Z'")).run(booked.result?.appointmentId));
    const result= (await f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"next week"}));
    expect(result.status).toBe("availability");expect((result.facts?.availabilityWindows as any[])[0]).toMatchObject({date:"2026-10-05",startTime:"09:00",lastStartTime:"16:30"});
  });
  it.each(["tomorrow","بكرة"])("resolves relative %s even when Hijri labels were requested",async dateExpression=>{
    const f= (await setup());const result= (await f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression,calendar:"hijri"}));
    expect(result.status).toBe("availability");expect(result.facts?.window).toEqual({fromDate:"2026-10-04",toDate:"2026-10-05"});
    expect(result.facts?.availabilityWindows).toMatchObject([{date:"2026-10-04",startTime:"09:00",lastStartTime:"16:30"}]);
  });
  it("honors explicit date bounds over a relative window and requires a day before exact lookup",async ()=>{
    const f= (await setup());const range= (await f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"next week",fromDate:"2026-10-06",toDate:"2026-10-08",exactTime:"09:00"}));
    expect(range).toMatchObject({status:"needs_clarification",issues:["exact_time_requires_single_date"]});expect(range.snapshot.offers).toEqual([]);
    const result= (await f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-06",exactTime:"09:00"}));
    expect(result.facts?.window).toEqual({fromDate:"2026-10-06",toDate:"2026-10-07"});expect(result.snapshot.offers[0].startsAtUtc).toBe("2026-10-06T06:00:00.000Z");
    const g= (await setup(()=>new Date("2026-12-31T21:01:00Z")));expect( (await g.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"next week"})).facts?.window).toEqual({fromDate:"2027-01-03",toDate:"2027-01-10"});
  });
  it.each(["completed","interrupted"] as const)("does not infer presentation from a lone %s media event",async exposure=>{
    const f= (await setup()); (await f.command("set_booking_details",{patientName:"Test Caller"})); (await f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"09:00"}));const offerId=f.snapshot().offers[0].offerId;
     (await f.service.recordMediaEvent(f.snapshot().sessionId,{eventId:"no-start",connectionId:"connection",outputId:"output",inputSequence:2,eventSequence:21,medium:"audio",exposure,offerIds:[offerId]}));
    expect( (await f.command("accept_offer",{offerId,decision:"accept",detailsCommunicated:true})).status).toBe("needs_clarification");expect( (await count(f.db,"reception_appointments"))).toBe(0);
  });
  it("accepts a genuinely started presentation even when later interrupted",async ()=>{
    const f= (await setup()); (await f.command("set_booking_details",{patientName:"Test Caller"})); (await f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"09:00"})); (await f.expose());const offerId=f.snapshot().offers[0].offerId;
     (await f.service.recordMediaEvent(f.snapshot().sessionId,{eventId:"interrupted-after-start",connectionId:"connection",outputId:"output",inputSequence:2,eventSequence:22,medium:"audio",exposure:"interrupted",offerIds:[offerId]}));
    expect( (await f.command("accept_offer",{offerId,decision:"accept",detailsCommunicated:true})).status).toBe("ready");
  });
  it.each(["close","emergency"])("retains a committed result when %s fences a later pending operation",async fence=>{
    const f= (await setup());const first= (await f.prepare());const saved= (await f.command("commit_request",{operationId:first.operationId}));const next= (await f.prepare("doc-002"));
    if(fence==="close") await f.service.closeSession(f.snapshot().sessionId,{eventId:"fence",expectedVersion:f.snapshot().version,outcome:"completed"});else  (await f.command("set_emergency",{active:true}));
    expect( (await f.command("commit_request",{operationId:next.operationId}))).toMatchObject({status:"rejected",result:{issue:"superseded"}});
    expect( (await f.command("get_operation",{operationId:first.operationId}))).toMatchObject({status:"committed",result:{appointmentId:saved.result?.appointmentId}});
    expect( (await count(f.db,"reception_appointments"))).toBe(1);expect( (await count(f.db,"reception_effects"))).toBe(1);
  });
  it("makes farewell a pending media close while a real close remains fenced", async () => {
    const f= (await setup());expect( (await f.command("end_session",{outcome:"completed"})).snapshot.status).toBe("active");expect( (await f.command("set_booking_details",{patientName:"Continued Caller"})).status).toBe("updated");
  });
  it.each([["2026-10-04T05:00:00.000Z","on_time"],["2026-10-04T04:59:59.000Z","late_no_show"]])("classifies cancellation at %s as %s and releases capacity for rebooking",async (starts,classification)=>{
    let now=new Date("2026-10-03T03:00:00Z");const f= (await setup(()=>now));const ready= (await f.prepare());const committed= (await f.command("commit_request",{operationId:ready.operationId}));const id=String(committed.result?.appointmentId);
     (await (await f.db.prepare("UPDATE reception_appointments SET starts_at_utc=? WHERE id=?")).run(starts,id));now=clock();
     (await f.command("find_my_appointments",{})); (await f.command("select_appointment",{appointmentId:id,action:"cancel"}));expect(f.snapshot().offers[0].consequence).toBe(classification); (await f.expose());const cancel= (await f.command("accept_offer",{offerId:f.snapshot().offers[0].offerId,decision:"accept",detailsCommunicated:true}));
    const result= (await f.command("commit_request",{operationId:cancel.operationId}));expect(result.result).toMatchObject({status:"cancelled",classification});expect( (await count(f.db,"reception_occupancy"))).toBe(0);
    const another= (await f.prepare());expect( (await f.command("commit_request",{operationId:another.operationId})).status).toBe("committed");expect( (await count(f.db,"reception_appointments"))).toBe(2);
  });
  it("selects a summary-link target and requires offer acceptance without exposing clinical data",async ()=>{
    const f= (await setup());const ready= (await f.prepare());const saved= (await f.command("commit_request",{operationId:ready.operationId})); (await f.command("find_my_appointments",{}));
    expect( (await f.command("select_appointment",{appointmentId:"wrong-target",action:"summary_link"})).status).toBe("not_found");
     (await f.command("select_appointment",{appointmentId:saved.result?.appointmentId,action:"summary_link"})); (await f.expose());const accepted= (await f.command("accept_offer",{offerId:f.snapshot().offers[0].offerId,decision:"accept",detailsCommunicated:true}));const summary= (await f.command("commit_request",{operationId:accepted.operationId}));
    expect(summary.result).toMatchObject({appointmentId:saved.result?.appointmentId,simulated:true,containsClinicalContent:false});expect( (await count(f.db,"reception_appointments"))).toBe(1);expect( (await f.service.activity()).effects[0].kind).toBe("summary_link");
  });
});
