import { Router } from "express";
import { z } from "zod";
import { receptionCloseSchema, receptionCommandSchema, receptionMediaEventSchema } from "../../shared/reception";
import { ReceptionService } from "./service";
const sessionSchema=z.object({callingNumber:z.string().optional()}).strict();
const tools=new Set(["clinic_information","find_available_slots","set_booking_details","capture_contact","confirm_contact","accept_offer","commit_request","get_operation","find_my_appointments","select_appointment","record_followup","set_emergency","end_session"]);
export function createReceptionRouter(service:ReceptionService):Router {
  const router=Router();
  router.post("/sessions",(req,res)=>{const parsed=sessionSchema.safeParse(req.body??{});if(!parsed.success){res.status(400).json({error:"invalid_session_metadata"});return;}try{res.status(201).json(service.createSession(parsed.data.callingNumber));}catch{res.status(400).json({error:"invalid_calling_number"});}});
  router.get("/activity",(_req,res)=>{res.json(service.activity());});
  router.use("/sessions/:id",(req,res,next)=>{if(!service.getSnapshot(String(req.params.id))){res.status(404).json({error:"session_not_found"});return;}next();});
  router.get("/sessions/:id",(req,res)=>{res.json(service.getSnapshot(String(req.params.id)));});
  router.post("/sessions/:id/tools",(req,res)=>{const parsed=receptionCommandSchema.safeParse(req.body);if(!parsed.success||!tools.has(parsed.data.tool)){res.status(400).json({error:"invalid_command"});return;}res.json(service.execute(String(req.params.id),parsed.data));});
  router.post("/sessions/:id/events",(req,res)=>{const parsed=receptionMediaEventSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:"invalid_media_event"});return;}res.json(service.recordMediaEvent(String(req.params.id),parsed.data));});
  router.get("/sessions/:id/events/:eventId",(req,res)=>{res.json(service.getEvent(String(req.params.id),String(req.params.eventId)));});
  router.post("/sessions/:id/close",(req,res)=>{const parsed=receptionCloseSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:"invalid_close"});return;}res.json(service.closeSession(String(req.params.id),parsed.data));});
  return router;
}
