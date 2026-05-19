import type { Metadata } from "next";
import { Nav } from "@/components/shell/Nav";
import { Footer } from "@/components/sections/Footer";
import { ArchitectureSection } from "@/components/sections/ArchitectureSection";

export const metadata: Metadata = {
  title: "Mimari",
  description:
    "Thundrly mimarisi: landing, Chrome eklentisi ve FastAPI backend; paylaşılan AnalyzeRequest/AnalyzeResponse sözleşmesi, LangGraph orkestrasyonu ve karar mantığı.",
  alternates: { canonical: "/mimari" },
};

export default function MimariPage() {
  return (
    <>
      <Nav />
      <ArchitectureSection />
      <Footer />
    </>
  );
}
