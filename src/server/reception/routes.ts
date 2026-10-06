import { Router, type NextFunction, type Request, type Response, type RequestHandler } from "express";
import { z } from "zod";
import { receptionCloseSchema, receptionCommandSchema, receptionMediaEventSchema } from "../../shared/reception";
import { ReceptionService } from "./service";

const sessionSchema=z.object({callingNumber:z.string().optional()}).strict();
const tools=new Set(["clinic_information","find_available_slots","set_booking_details","capture_contact","confirm_contact","accept_offer","commit_request","get_operation","find_my_appointments","select_appointment","record_followup","set_emergency","end_session"]);
const asyncRoute=(handler:(request:Request,response:Response,next:NextFunction)=>Promise<void>):RequestHandler=>(request,response,next)=>{void handler(request,response,next).catch(next);};

function normalizedRoute(path: string): string {
  const routes: Array<[RegExp, string]> = [
    [/^\/sessions\/?$/i, "/sessions"],
    [/^\/activity\/?$/i, "/activity"],
    [/^\/sessions\/[^/]+\/?$/i, "/sessions/:id"],
    [/^\/sessions\/[^/]+\/keep-warm\/?$/i, "/sessions/:id/keep-warm"],
    [/^\/sessions\/[^/]+\/tools\/?$/i, "/sessions/:id/tools"],
    [/^\/sessions\/[^/]+\/events\/?$/i, "/sessions/:id/events"],
    [/^\/sessions\/[^/]+\/events\/[^/]+\/?$/i, "/sessions/:id/events/:eventId"],
    [/^\/sessions\/[^/]+\/close\/?$/i, "/sessions/:id/close"],
  ];
  return `/api/reception${routes.find(([pattern]) => pattern.test(path))?.[1] ?? "/unmatched"}`;
}

const timedResponses = new WeakSet<Response>();
export const receptionTimingLogger: RequestHandler = (req,res,next)=>{
  // The app installs this before its body parser; standalone routers also use
  // it. One response must only acquire one completion listener.
  if (!timedResponses.has(res)) {
    timedResponses.add(res);
    const started=performance.now(), route=normalizedRoute(req.path), method=req.method;
    res.once("finish",()=>{
      try { console.info({method,route,status:res.statusCode,durationMs:Math.round((performance.now()-started)*100)/100}); }
      catch { /* Diagnostics never affect the reception response. */ }
    });
  }
  next();
};

export function createReceptionRouter(service:ReceptionService, options:{exposeActivity?:boolean}={}):Router {
  const router=Router();
  router.use(receptionTimingLogger);
  router.post("/sessions",asyncRoute(async(req,res,next)=>{
    const parsed=sessionSchema.safeParse(req.body??{});if(!parsed.success){res.status(400).json({error:"invalid_session_metadata"});return;}
    try { res.status(201).json(await service.createSession(parsed.data.callingNumber)); }
    catch(error) { if(error instanceof Error&&error.message==="invalid_calling_number")res.status(400).json({error:"invalid_calling_number"});else next(error); }
  }));
  if(options.exposeActivity) router.get("/activity",asyncRoute(async(_req,res)=>{res.json(await service.activity());}));
  router.get("/sessions/:id",asyncRoute(async(req,res)=>{
    const snapshot=await service.getSnapshot(String(req.params.id));
    if(!snapshot){res.status(404).json({error:"session_not_found"});return;}
    res.json(snapshot);
  }));
  router.use("/sessions/:id",asyncRoute(async(req,res,next)=>{if(!await service.hasSession(String(req.params.id))){res.status(404).json({error:"session_not_found"});return;}next();}));
  router.get("/sessions/:id/keep-warm",asyncRoute(async(_req,res)=>{res.json({status:"ok"});}));
  router.post("/sessions/:id/tools",asyncRoute(async(req,res)=>{const parsed=receptionCommandSchema.safeParse(req.body);if(!parsed.success||!tools.has(parsed.data.tool)){res.status(400).json({error:"invalid_command"});return;}res.json(await service.execute(String(req.params.id),parsed.data));}));
  router.post("/sessions/:id/events",asyncRoute(async(req,res)=>{const parsed=receptionMediaEventSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:"invalid_media_event"});return;}res.json(await service.recordMediaEvent(String(req.params.id),parsed.data));}));
  router.get("/sessions/:id/events/:eventId",asyncRoute(async(req,res)=>{res.json(await service.getEvent(String(req.params.id),String(req.params.eventId)));}));
  router.post("/sessions/:id/close",asyncRoute(async(req,res)=>{const parsed=receptionCloseSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:"invalid_close"});return;}res.json(await service.closeSession(String(req.params.id),parsed.data));}));
  return router;
}
