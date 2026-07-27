import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { ApiFailure, ApiSuccess } from "@/lib/contracts";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function ok<T>(data: T, requestId = crypto.randomUUID(), status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ success: true, data, requestId }, { status });
}

export function handleApiError(error: unknown, requestId = crypto.randomUUID()) {
  if (error instanceof ApiError) {
    return NextResponse.json<ApiFailure>(
      {
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
        requestId
      },
      { status: error.status }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json<ApiFailure>(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Some information is missing or invalid. Check the form and try again.",
          details: error.issues
        },
        requestId
      },
      { status: 400 }
    );
  }

  console.error(JSON.stringify({ level: "error", requestId, message: "Unexpected API error", error: String(error) }));
  return NextResponse.json<ApiFailure>(
    {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
      requestId
    },
    { status: 500 }
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "The request body must be valid JSON.");
  }
}
