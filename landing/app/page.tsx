import { Nav } from "@/components/shell/Nav";
import { Hero } from "@/components/sections/Hero";
import { ProblemSection } from "@/components/sections/ProblemSection";
import { SolutionSection } from "@/components/sections/SolutionSection";
import { AgentSystemSection } from "@/components/sections/AgentSystemSection";
import { LiveDemoSection } from "@/components/sections/LiveDemoSection";
import { WhyUniqueSection } from "@/components/sections/WhyUniqueSection";
import { AudienceSection } from "@/components/sections/AudienceSection";
import { VerdictShowcaseSection } from "@/components/sections/VerdictShowcaseSection";
import { FinalCTASection } from "@/components/sections/FinalCTASection";
import { Footer } from "@/components/sections/Footer";

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <ProblemSection />
        <SolutionSection />
        <AgentSystemSection />
        <LiveDemoSection />
        <WhyUniqueSection />
        <AudienceSection />
        <VerdictShowcaseSection />
        <FinalCTASection />
      </main>
      <Footer />
    </>
  );
}
