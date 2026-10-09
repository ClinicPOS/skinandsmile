"use client";
import {AppFrame} from "../../components/app-frame";
import {RefundApprovalQueue} from "../../components/refund-approval-queue";
export default function RefundsPage(){return <AppFrame title="Corrections & refunds" description="Request manager approval before returning money."><main className="mx-auto max-w-5xl p-5"><RefundApprovalQueue/></main></AppFrame>;}
