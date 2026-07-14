import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type ReceiptRow = {
  id: string;
  patient_id: string | null;
  receptionist_id: string;
  created_at: string;
};

type ReceiptItemRow = {
  receipt_id: string;
  service_id: string;
  total: number | string | null;
  price: number | string | null;
};

type ServiceRow = {
  id: string;
  name: string | null;
};

type ServiceAggregate = {
  id: string;
  name: string;
  count: number;
  revenue: number;
  patientIds: Set<string>;
  doctorIds: Set<string>;
};

function parseDateParam(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatTrendLabel(dateValue: string): string {
  return new Date(dateValue).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getItemRevenue(item: ReceiptItemRow): number {
  return Number(item.total ?? item.price ?? 0);
}

function getErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>;
    return {
      message: typeof errorRecord.message === "string" ? errorRecord.message : "Failed to load top services analytics.",
      details: typeof errorRecord.details === "string" ? errorRecord.details : undefined,
      hint: typeof errorRecord.hint === "string" ? errorRecord.hint : undefined,
      code: typeof errorRecord.code === "string" ? errorRecord.code : undefined,
    };
  }

  return {
    message: typeof error === "string" ? error : "Failed to load top services analytics.",
  };
}

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json({ error: "Supabase configuration is missing." }, { status: 500 });
  }

  const url = new URL(request.url);
  const clinicId = url.searchParams.get("clinicId");
  const serviceId = url.searchParams.get("serviceId");
  const from = parseDateParam(url.searchParams.get("from"));
  const to = parseDateParam(url.searchParams.get("to"));

  if (!from || !to) {
    return Response.json({ error: "Valid from and to query parameters are required." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  try {
    let receptionistIds: string[] | null = null;

    if (clinicId) {
      const { data: clinicReceptionists, error: receptionistsError } = await supabase
        .from("receptionist")
        .select("id")
        .eq("clinic_id", clinicId);

      if (receptionistsError) {
        throw receptionistsError;
      }

      receptionistIds = (clinicReceptionists || []).map((entry) => entry.id);

      if (receptionistIds.length === 0) {
        return Response.json({
          summary: {
            services: [],
            totalRevenue: 0,
            uniqueServices: 0,
            mostPerformed: null,
            highestRevenue: null,
          },
          detail: null,
        });
      }
    }

    let receiptsQuery = supabase
      .from("receipts")
      .select("id, patient_id, receptionist_id, created_at")
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString());

    if (receptionistIds) {
      receiptsQuery = receiptsQuery.in("receptionist_id", receptionistIds);
    }

    const { data: receipts, error: receiptsError } = await receiptsQuery;

    if (receiptsError) {
      throw receiptsError;
    }

    const filteredReceipts = (receipts || []) as ReceiptRow[];
    if (filteredReceipts.length === 0) {
      return Response.json({
        summary: {
          services: [],
          totalRevenue: 0,
          uniqueServices: 0,
          mostPerformed: null,
          highestRevenue: null,
        },
        detail: null,
      });
    }

    const receiptIds = filteredReceipts.map((receipt) => receipt.id);
    const receiptMap = new Map(filteredReceipts.map((receipt) => [receipt.id, receipt]));

    const { data: receiptItems, error: itemsError } = await supabase
      .from("receipt_items")
      .select("receipt_id, service_id, total, price")
      .in("receipt_id", receiptIds);

    if (itemsError) {
      throw itemsError;
    }

    const serviceMap: Record<string, ServiceAggregate> = {};
    const relevantItems = (receiptItems || []) as ReceiptItemRow[];
    const serviceIds = Array.from(new Set(relevantItems.map((item) => item.service_id)));
    const serviceNameMap = new Map<string, string>();

    if (serviceIds.length > 0) {
      const { data: services, error: servicesError } = await supabase
        .from("services")
        .select("id, name")
        .in("id", serviceIds);

      if (servicesError) {
        throw servicesError;
      }

      for (const service of (services || []) as ServiceRow[]) {
        if (service.name) {
          serviceNameMap.set(service.id, service.name);
        }
      }
    }

    for (const item of relevantItems) {
      const name = serviceNameMap.get(item.service_id) || "Unknown Service";
      const aggregate = serviceMap[item.service_id] || {
        id: item.service_id,
        name,
        count: 0,
        revenue: 0,
        patientIds: new Set<string>(),
        doctorIds: new Set<string>(),
      };

      aggregate.count += 1;
      aggregate.revenue += getItemRevenue(item);

      const receipt = receiptMap.get(item.receipt_id);
      if (receipt?.patient_id) {
        aggregate.patientIds.add(receipt.patient_id);
      }

      serviceMap[item.service_id] = aggregate;
    }

    const services = Object.values(serviceMap)
      .map((service) => ({
        id: service.id,
        name: service.name,
        count: service.count,
        revenue: service.revenue,
        patientCount: service.patientIds.size,
        doctorCount: service.doctorIds.size,
      }))
      .sort((left, right) => right.revenue - left.revenue);

    const totalRevenue = services.reduce((sum, service) => sum + service.revenue, 0);
    const servicesWithShare = services.map((service, index) => ({
      ...service,
      revenueShare: totalRevenue > 0 ? (service.revenue / totalRevenue) * 100 : 0,
      isTopPerformer: index === 0,
    }));

    const summary = {
      services: servicesWithShare,
      totalRevenue,
      uniqueServices: servicesWithShare.length,
      mostPerformed:
        servicesWithShare.length > 0
          ? servicesWithShare.reduce((best, current) => (current.count > best.count ? current : best), servicesWithShare[0])
          : null,
      highestRevenue: servicesWithShare[0] || null,
    };

    let detail = null;

    if (serviceId && serviceMap[serviceId]) {
      const selectedAggregate = serviceMap[serviceId];
      const selectedItems = relevantItems.filter((item) => item.service_id === serviceId);
      const patientIds = Array.from(selectedAggregate.patientIds);
      const doctorIds = Array.from(selectedAggregate.doctorIds);

      const [patientsResult, doctorsResult] = await Promise.all([
        patientIds.length > 0
          ? supabase.from("patients").select("id, name").in("id", patientIds)
          : Promise.resolve({ data: [], error: null }),
        doctorIds.length > 0
          ? supabase.from("doctors").select("id, name").in("id", doctorIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (patientsResult.error) {
        throw patientsResult.error;
      }
      if (doctorsResult.error) {
        throw doctorsResult.error;
      }

      const patientNameMap = new Map((patientsResult.data || []).map((patient) => [patient.id, patient.name]));
      const doctorNameMap = new Map((doctorsResult.data || []).map((doctor) => [doctor.id, doctor.name]));

      const trendMap = new Map<string, { date: string; label: string; revenue: number; count: number }>();

      for (const item of selectedItems) {
        const receipt = receiptMap.get(item.receipt_id);
        if (!receipt) continue;

        const dayKey = receipt.created_at.slice(0, 10);
        const trendEntry = trendMap.get(dayKey) || {
          date: dayKey,
          label: formatTrendLabel(receipt.created_at),
          revenue: 0,
          count: 0,
        };

        trendEntry.revenue += getItemRevenue(item);
        trendEntry.count += 1;
        trendMap.set(dayKey, trendEntry);
      }

      detail = {
        id: selectedAggregate.id,
        name: selectedAggregate.name,
        revenue: selectedAggregate.revenue,
        count: selectedAggregate.count,
        averagePrice: selectedAggregate.count > 0 ? selectedAggregate.revenue / selectedAggregate.count : 0,
        patientCount: patientIds.length,
        revenueShare: totalRevenue > 0 ? (selectedAggregate.revenue / totalRevenue) * 100 : 0,
        patients: patientIds.map((patientId) => ({
          id: patientId,
          name: patientNameMap.get(patientId) || patientId,
        })),
        doctors: doctorIds.map((doctorId) => ({
          id: doctorId,
          name: doctorNameMap.get(doctorId) || doctorId,
        })),
        revenueTrend: Array.from(trendMap.values()).sort((left, right) => left.date.localeCompare(right.date)),
      };
    }

    return Response.json({ summary, detail });
  } catch (error) {
    const errorDetails = getErrorDetails(error);
    console.error("Top services analytics error:", errorDetails);
    return Response.json(
      {
        error: errorDetails.message,
        details: errorDetails.details,
        hint: errorDetails.hint,
        code: errorDetails.code,
      },
      { status: 500 }
    );
  }
}