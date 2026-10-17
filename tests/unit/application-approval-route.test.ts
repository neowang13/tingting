import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({ requireAdminRequest:vi.fn(), resend:vi.fn(), rateLimit:vi.fn() }));
vi.mock("@/lib/auth", async original=>({ ...await original<typeof import("@/lib/auth")>(), requireAdminRequest:mocks.requireAdminRequest }));
vi.mock("@/lib/rate-limit",()=>({assertActionRateLimit:mocks.rateLimit}));
vi.mock("@/features/applications/service",()=>({updateApplicationStatus:vi.fn(),resendApplicationApproval:mocks.resend}));
import {POST} from "@/app/api/admin/applications/[id]/route";
import {ApiError} from "@/lib/api";
const id=crypto.randomUUID();
function request(origin="https://example.test") {
 return new Request(`https://example.test/api/admin/applications/${id}`,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({action:"resend_approval",deliveryId:crypto.randomUUID()})});
}
beforeEach(()=>{
 vi.clearAllMocks();
 mocks.requireAdminRequest.mockResolvedValue({userId:"admin"});
 mocks.rateLimit.mockResolvedValue(undefined);
 mocks.resend.mockResolvedValue({status:"approved",applicantNotification:{status:"queued",recipientEmail:"account@example.test"}});
});
describe("approval email resend authorization",()=>{
 it("requires an Admin session",async()=>{
  mocks.requireAdminRequest.mockRejectedValue(new ApiError(401,"UNAUTHORIZED","Sign in."));
  expect((await POST(request(),{params:Promise.resolve({id})})).status).toBe(401);
  expect(mocks.resend).not.toHaveBeenCalled();
 });
 it("rejects cross-origin requests before sending",async()=>{
  expect((await POST(request("https://attacker.example"),{params:Promise.resolve({id})})).status).toBe(403);
  expect(mocks.resend).not.toHaveBeenCalled();
 });
 it("rate-limits the authorized action and returns the actual recipient",async()=>{
  const response=await POST(request(),{params:Promise.resolve({id})});
  expect(response.status).toBe(200);
  expect(mocks.rateLimit).toHaveBeenCalledWith("admin","application-approval-email",10,900);
  expect((await response.json()).data.applicantNotification.recipientEmail).toBe("account@example.test");
 });
});
