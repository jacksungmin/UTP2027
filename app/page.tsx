"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  Bot,
  Database,
  Filter,
  MapPinned,
  Search,
  TableProperties,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type RegionGroup = "8-county MPO" | "5-county non-MPO";

type Project = {
  csj: string;
  county: string;
  district: string;
  corridor: string;
  description: string;
  category: string;
  tier: "Tier 1" | "Tier 2";
  fiscalYear: number;
  amount: number;
  group: RegionGroup;
  status: "RTP match" | "Possible RTP match" | "Needs review";
};

const counties = [
  "Austin",
  "Brazoria",
  "Chambers",
  "Colorado",
  "Fort Bend",
  "Galveston",
  "Harris",
  "Liberty",
  "Matagorda",
  "Montgomery",
  "Walker",
  "Waller",
  "Wharton",
];

const projects: Project[] = [
  {
    csj: "0912-72-652",
    county: "Harris",
    district: "Houston",
    corridor: "I-45",
    description: "North Houston corridor reconstruction and downtown system improvements",
    category: "Category 12",
    tier: "Tier 1",
    fiscalYear: 2028,
    amount: 1850,
    group: "8-county MPO",
    status: "RTP match",
  },
  {
    csj: "0271-04-070",
    county: "Waller",
    district: "Houston",
    corridor: "I-10",
    description: "I-10 west capacity and managed-lane development toward FM 359",
    category: "Category 2",
    tier: "Tier 1",
    fiscalYear: 2030,
    amount: 720,
    group: "8-county MPO",
    status: "Possible RTP match",
  },
  {
    csj: "0027-13-200",
    county: "Fort Bend",
    district: "Houston",
    corridor: "I-69 / US 59",
    description: "Suburban corridor modernization and interchange reconstruction",
    category: "Category 4",
    tier: "Tier 1",
    fiscalYear: 2031,
    amount: 610,
    group: "8-county MPO",
    status: "RTP match",
  },
  {
    csj: "0598-02-119",
    county: "Brazoria",
    district: "Houston",
    corridor: "SH 288",
    description: "South regional mobility, frontage road, and access improvements",
    category: "Category 7",
    tier: "Tier 2",
    fiscalYear: 2033,
    amount: 390,
    group: "8-county MPO",
    status: "Possible RTP match",
  },
  {
    csj: "0500-04-145",
    county: "Galveston",
    district: "Houston",
    corridor: "I-45",
    description: "Gulf Freeway resiliency, evacuation access, and bottleneck relief",
    category: "Category 12",
    tier: "Tier 1",
    fiscalYear: 2029,
    amount: 540,
    group: "8-county MPO",
    status: "RTP match",
  },
  {
    csj: "0739-02-164",
    county: "Montgomery",
    district: "Houston",
    corridor: "SH 105",
    description: "East-west connectivity and safety improvements near Conroe",
    category: "Category 4",
    tier: "Tier 2",
    fiscalYear: 2032,
    amount: 260,
    group: "8-county MPO",
    status: "Needs review",
  },
  {
    csj: "0508-01-377",
    county: "Chambers",
    district: "Beaumont",
    corridor: "I-10",
    description: "Regional freight connectivity and interstate capacity improvements",
    category: "Category 4",
    tier: "Tier 1",
    fiscalYear: 2028,
    amount: 430,
    group: "8-county MPO",
    status: "Possible RTP match",
  },
  {
    csj: "1051-02-041",
    county: "Liberty",
    district: "Beaumont",
    corridor: "SH 99 / US 90",
    description: "Outer-area connectivity, safety, and growth-response improvements",
    category: "Category 8",
    tier: "Tier 2",
    fiscalYear: 2034,
    amount: 180,
    group: "8-county MPO",
    status: "Needs review",
  },
  {
    csj: "0177-03-096",
    county: "Walker",
    district: "Bryan",
    corridor: "I-45",
    description: "Rural interstate preservation, safety, and north-south mobility",
    category: "Category 1",
    tier: "Tier 1",
    fiscalYear: 2027,
    amount: 210,
    group: "5-county non-MPO",
    status: "Needs review",
  },
  {
    csj: "0089-05-082",
    county: "Wharton",
    district: "Yoakum",
    corridor: "US 59 / I-69",
    description: "Freight corridor upgrade and future interstate connectivity",
    category: "Category 4",
    tier: "Tier 2",
    fiscalYear: 2035,
    amount: 330,
    group: "5-county non-MPO",
    status: "Possible RTP match",
  },
  {
    csj: "0188-02-044",
    county: "Matagorda",
    district: "Yoakum",
    corridor: "SH 35",
    description: "Coastal connectivity, port access, and evacuation route reliability",
    category: "Category 10",
    tier: "Tier 2",
    fiscalYear: 2033,
    amount: 145,
    group: "5-county non-MPO",
    status: "Needs review",
  },
  {
    csj: "0266-03-112",
    county: "Colorado",
    district: "Yoakum",
    corridor: "I-10",
    description: "Rural interstate preservation and freight movement improvements",
    category: "Category 1",
    tier: "Tier 1",
    fiscalYear: 2029,
    amount: 190,
    group: "5-county non-MPO",
    status: "Needs review",
  },
  {
    csj: "0271-01-088",
    county: "Austin",
    district: "Yoakum",
    corridor: "I-10 / US 90",
    description: "System preservation and rural safety improvements west of Houston",
    category: "Category 8",
    tier: "Tier 2",
    fiscalYear: 2031,
    amount: 115,
    group: "5-county non-MPO",
    status: "Needs review",
  },
];

const regionOptions = ["All H-GAC", "8-county MPO", "5-county non-MPO"];
const categoryOptions = ["All categories", ...Array.from(new Set(projects.map((project) => project.category)))];
const corridorOptions = ["All corridors", ...Array.from(new Set(projects.map((project) => project.corridor)))];

const money = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

function formatMoney(amount: number) {
  return `$${money.format(amount)}M`;
}

function totalAmount(records: Project[]) {
  return records.reduce((sum, project) => sum + project.amount, 0);
}

function groupTotals(records: Project[], key: keyof Pick<Project, "county" | "category" | "corridor">) {
  return Object.entries(
    records.reduce<Record<string, number>>((acc, project) => {
      acc[project[key]] = (acc[project[key]] ?? 0) + project.amount;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
}

export default function Home() {
  const [region, setRegion] = useState(regionOptions[0]);
  const [county, setCounty] = useState("All counties");
  const [category, setCategory] = useState(categoryOptions[0]);
  const [corridor, setCorridor] = useState(corridorOptions[0]);
  const [query, setQuery] = useState("");

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return projects.filter((project) => {
      const regionMatch = region === "All H-GAC" || project.group === region;
      const countyMatch = county === "All counties" || project.county === county;
      const categoryMatch = category === "All categories" || project.category === category;
      const corridorMatch = corridor === "All corridors" || project.corridor === corridor;
      const queryMatch =
        normalizedQuery.length === 0 ||
        [
          project.csj,
          project.county,
          project.district,
          project.corridor,
          project.description,
          project.category,
          project.status,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return regionMatch && countyMatch && categoryMatch && corridorMatch && queryMatch;
    });
  }, [category, corridor, county, query, region]);

  const allTotal = totalAmount(projects);
  const filteredTotal = totalAmount(filteredProjects);
  const mpoTotal = totalAmount(filteredProjects.filter((project) => project.group === "8-county MPO"));
  const nonMpoTotal = totalAmount(filteredProjects.filter((project) => project.group === "5-county non-MPO"));
  const tierOneCount = filteredProjects.filter((project) => project.tier === "Tier 1").length;
  const firstFourYears = filteredProjects.filter((project) => project.fiscalYear <= 2030).length;
  const countyTotals = groupTotals(filteredProjects, "county");
  const categoryTotals = groupTotals(filteredProjects, "category");
  const corridorTotals = groupTotals(filteredProjects, "corridor");
  const maxCounty = Math.max(...countyTotals.map(([, amount]) => amount), 1);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b bg-[linear-gradient(180deg,#f8fafc_0%,#edf4ef_100%)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground">
                <Badge variant="outline" className="rounded-md border-emerald-200 bg-emerald-50 text-emerald-800">
                  2027 UTP
                </Badge>
                <span>H-GAC Regional Transportation Investment Tool</span>
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl">
                UTP Explorer
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700 sm:text-base">
                Explore how the Unified Transportation Program affects the 8-county MPO,
                the five non-MPO H-GAC counties, and the full 13-county region.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-lg border bg-white p-2 shadow-sm">
              <div className="px-3 py-2">
                <p className="text-xs text-muted-foreground">Statewide headline</p>
                <p className="text-lg font-semibold">$138B</p>
              </div>
              <div className="border-l px-3 py-2">
                <p className="text-xs text-muted-foreground">UTP program</p>
                <p className="text-lg font-semibold">$95B</p>
              </div>
              <div className="border-l px-3 py-2">
                <p className="text-xs text-muted-foreground">Sample loaded</p>
                <p className="text-lg font-semibold">{formatMoney(allTotal)}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border bg-white p-3 shadow-sm lg:grid-cols-[1fr_1fr_1fr_1.3fr_auto]">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Geography
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {regionOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              County
              <Select value={county} onValueChange={setCounty}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All counties">All counties</SelectItem>
                  {counties.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Funding
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Corridor
              <Select value={corridor} onValueChange={setCorridor}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {corridorOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <Button
              type="button"
              variant="outline"
              className="self-end"
              onClick={() => {
                setRegion("All H-GAC");
                setCounty("All counties");
                setCategory("All categories");
                setCorridor("All corridors");
                setQuery("");
              }}
            >
              <Filter /> Reset
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <div className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Filtered investment" value={formatMoney(filteredTotal)} detail={`${filteredProjects.length} projects in view`} />
            <MetricCard label="8-county MPO" value={formatMoney(mpoTotal)} detail="Metropolitan planning area" />
            <MetricCard label="5 non-MPO counties" value={formatMoney(nonMpoTotal)} detail="Rural and regional program context" />
            <MetricCard label="Near-term projects" value={`${firstFourYears}`} detail={`${tierOneCount} Tier 1 projects`} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <section className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    <BarChart3 className="size-4 text-emerald-700" /> County Investment
                  </h2>
                  <p className="text-sm text-muted-foreground">Top counties in the active filter.</p>
                </div>
                <Badge variant="secondary" className="rounded-md">
                  Preliminary
                </Badge>
              </div>
              <div className="space-y-3">
                {countyTotals.map(([name, amount]) => (
                  <div key={name}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium">{name}</span>
                      <span className="text-muted-foreground">{formatMoney(amount)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-emerald-700"
                        style={{ width: `${Math.max((amount / maxCounty) * 100, 4)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <MapPinned className="size-4 text-cyan-700" /> Corridor Snapshot
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Corridors are grouped from the project list so staff can think beyond county lines.
              </p>
              <div className="mt-4 grid gap-2">
                {corridorTotals.map(([name, amount]) => (
                  <div key={name} className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                    <span className="text-sm font-medium">{name}</span>
                    <span className="text-sm text-muted-foreground">{formatMoney(amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <TableProperties className="size-4 text-slate-700" /> Project Explorer
                </h2>
                <p className="text-sm text-muted-foreground">
                  Search CSJ, county, corridor, category, or description.
                </p>
              </div>
              <label className="relative block lg:w-80">
                <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search projects"
                  className="pl-8"
                />
              </label>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CSJ</TableHead>
                  <TableHead>County</TableHead>
                  <TableHead>Corridor</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Funding</TableHead>
                  <TableHead>FY</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProjects.map((project) => (
                  <TableRow key={project.csj}>
                    <TableCell className="font-mono text-xs">{project.csj}</TableCell>
                    <TableCell>{project.county}</TableCell>
                    <TableCell className="font-medium">{project.corridor}</TableCell>
                    <TableCell className="max-w-[320px] whitespace-normal text-muted-foreground">
                      {project.description}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="rounded-md">
                          {project.category}
                        </Badge>
                        <Badge variant={project.tier === "Tier 1" ? "default" : "secondary"} className="rounded-md">
                          {project.tier}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>{project.fiscalYear}</TableCell>
                    <TableCell className="text-right font-semibold">{formatMoney(project.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </div>

        <aside className="grid gap-5 self-start">
          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Bot className="size-4 text-emerald-700" /> Ask the UTP
            </h2>
            <div className="mt-3 rounded-lg border bg-muted/30 p-3">
              <p className="text-sm font-medium">Try: Compare MPO and non-MPO investment.</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                In this filtered sample, the 8-county MPO accounts for{" "}
                <strong className="text-foreground">{formatMoney(mpoTotal)}</strong>, while the five
                non-MPO counties account for{" "}
                <strong className="text-foreground">{formatMoney(nonMpoTotal)}</strong>. The next build
                will route numeric questions to the project table and policy questions to the UTP text.
              </p>
            </div>
            <div className="mt-3 grid gap-2">
              {["Which projects affect I-45?", "Explain Category 12.", "Show Chambers and Liberty projects."].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="rounded-md border px-3 py-2 text-left text-sm transition hover:bg-muted"
                  onClick={() => setQuery(prompt.replace("Which projects affect ", "").replace("?", ""))}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Database className="size-4 text-cyan-700" /> Data Readiness
            </h2>
            <div className="mt-4 space-y-3 text-sm">
              {[
                ["MVP schema", "Ready"],
                ["2027 UTP Excel import", "Next"],
                ["PDF source citations", "Next"],
                ["RTP 2050 crosswalk", "Later"],
                ["Map geometry", "Later"],
              ].map(([label, status]) => (
                <div key={label} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                  <span>{label}</span>
                  <Badge variant={status === "Ready" ? "default" : "secondary"} className="rounded-md">
                    {status}
                  </Badge>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="text-base font-semibold">Funding Categories</h2>
            <div className="mt-3 grid gap-2">
              {categoryTotals.map(([name, amount]) => (
                <div key={name} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <span>{name}</span>
                  <span className="font-medium">{formatMoney(amount)}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-normal">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </section>
  );
}
