import { ChatInterface } from "@/components/chat-interface";
import type { Metadata } from "next";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
const DEFAULT_BUSINESS_ID = process.env.NEXT_PUBLIC_BUSINESS_ID || "";

interface BusinessData {
  id: string;
  name: string;
  welcomeMessage: string;
  services: Array<{ name: string; duration_minutes: number; price: number }>;
  workingHours: Array<{ day: number; start: string; end: string }>;
  timezone: string;
}

async function fetchBusiness(id: string): Promise<BusinessData | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/business/${id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

interface PageProps {
  searchParams: Promise<{ businessId?: string }>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const businessId = params.businessId || DEFAULT_BUSINESS_ID;
  if (!businessId) {
    return { title: "Agente de Turnos" };
  }
  const business = await fetchBusiness(businessId);
  return {
    title: business ? business.name : "Agente de Turnos",
    description: business ? `Agenda un turno con ${business.name}` : "Sistema de agendamiento automático",
  };
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const businessId = params.businessId || DEFAULT_BUSINESS_ID;

  if (!businessId) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0e1621]">
        <div className="text-center px-6 max-w-sm">
          <div className="w-16 h-16 rounded-full bg-[#17212b] border border-[#1f2d3d] flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-[#4a6080]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-[#e8eaed] font-semibold text-lg mb-2">Configuración requerida</h1>
          <p className="text-[#8b9ab1] text-sm leading-relaxed">
            Configurá <code className="text-[#7eb8f7] bg-[#1f2d3d] px-1 rounded">NEXT_PUBLIC_BUSINESS_ID</code> en{" "}
            <code className="text-[#7eb8f7] bg-[#1f2d3d] px-1 rounded">.env.local</code> o pasá el parámetro{" "}
            <code className="text-[#7eb8f7] bg-[#1f2d3d] px-1 rounded">?businessId=...</code> en la URL.
          </p>
        </div>
      </div>
    );
  }

  const business = await fetchBusiness(businessId);

  if (!business) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0e1621]">
        <div className="text-center px-6 max-w-sm">
          <div className="w-16 h-16 rounded-full bg-[#17212b] border border-[#1f2d3d] flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-[#e05252]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-[#e8eaed] font-semibold text-lg mb-2">No se pudo conectar</h1>
          <p className="text-[#8b9ab1] text-sm leading-relaxed">
            Asegurate que el backend esté corriendo en{" "}
            <code className="text-[#7eb8f7] bg-[#1f2d3d] px-1 rounded">{BACKEND_URL}</code> y que el ID del negocio sea válido.
          </p>
        </div>
      </div>
    );
  }

  return (
    <main className="h-screen bg-[#0e1621] flex items-stretch justify-center">
      <ChatInterface
        businessId={businessId}
        businessName={business.name}
        businessServices={business.services ?? []}
        welcomeMessage={business.welcomeMessage}
      />
    </main>
  );
}
