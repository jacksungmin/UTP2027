import { mkdir, writeFile } from "node:fs/promises";
import shapefile from "shapefile";

const hgacCounties = new Set([
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
]);

const mpoCounties = new Set([
  "Brazoria",
  "Chambers",
  "Fort Bend",
  "Galveston",
  "Harris",
  "Liberty",
  "Montgomery",
  "Waller",
]);

const source = await shapefile.open(
  "GIS/TxDOT_Projects_Info.shp",
  "GIS/TxDOT_Projects_Info.dbf",
);

const fundingPairs = [
  ["FUND_CAT1_", "FUND_CAT11"],
  ["FUND_CAT2_", "FUND_CAT21"],
  ["FUND_CAT3_", "FUND_CAT31"],
  ["FUND_CAT4_", "FUND_CAT41"],
  ["FUND_CAT5_", "FUND_CAT51"],
  ["FUND_CAT6_", "FUND_CAT61"],
  ["FUND_CAT7_", "FUND_CAT71"],
  ["FUND_CAT8_", "FUND_CAT81"],
  ["FUND_CAT9_", "FUND_CAT91"],
  ["FUND_CAT10", "FUND_CAT_1"],
  ["FUND_CAT12", "FUND_CAT_4"],
];

const features = [];
let bbox = [Infinity, Infinity, -Infinity, -Infinity];

function simplifyLine(line) {
  if (line.length <= 80) {
    return line;
  }

  const step = Math.ceil(line.length / 80);
  const sampled = line.filter((_, index) => index % step === 0);
  const last = line.at(-1);
  if (last && sampled.at(-1) !== last) {
    sampled.push(last);
  }
  return sampled;
}

function simplifyGeometry(geometry) {
  if (!geometry) {
    return null;
  }

  if (geometry.type === "LineString") {
    return {
      ...geometry,
      coordinates: simplifyLine(geometry.coordinates),
    };
  }

  if (geometry.type === "MultiLineString") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map(simplifyLine),
    };
  }

  return geometry;
}

function visitCoordinates(geometry, callback) {
  if (!geometry) {
    return;
  }

  if (geometry.type === "LineString") {
    geometry.coordinates.forEach(callback);
  }

  if (geometry.type === "MultiLineString") {
    geometry.coordinates.flat().forEach(callback);
  }
}

function fundingCategories(properties) {
  return fundingPairs
    .filter(([labelField, amountField]) => properties[labelField] && Number(properties[amountField] ?? 0) > 0)
    .map(([labelField, amountField]) => ({
      label: properties[labelField],
      amount: Number(properties[amountField] ?? 0),
    }));
}

while (true) {
  const result = await source.read();
  if (result.done) {
    break;
  }

  const { geometry, properties } = result.value;
  const county = properties.COUNTY_NAM;

  if (!hgacCounties.has(county) || !geometry) {
    continue;
  }

  const simplifiedGeometry = simplifyGeometry(geometry);
  visitCoordinates(simplifiedGeometry, ([x, y]) => {
    bbox = [
      Math.min(bbox[0], x),
      Math.min(bbox[1], y),
      Math.max(bbox[2], x),
      Math.max(bbox[3], y),
    ];
  });

  const categories = fundingCategories(properties);

  features.push({
    type: "Feature",
    geometry: simplifiedGeometry,
    properties: {
      uniqueId: `${properties.PROJ_ID || properties.CONTROL_SE || "feature"}-${features.length}`,
      id: properties.PROJ_ID,
      csj: properties.CONTROL_SE,
      county,
      district: properties.DISTRICT_N,
      corridor: properties.HIGHWAY_NU || properties.HWY_NBR,
      from: properties.LIMITS_FRO,
      to: properties.LIMITS_TO,
      work: properties.TYPE_OF_WO,
      projectClass: properties.PROJ_CLASS,
      stage: properties.PROJ_STG,
      status: properties.PROJ_STAT,
      phase: properties.PT_PHASE,
      fiscalYear: properties.ESTMTD_FIS,
      estimatedConstruction: Number(properties.EST_CONSTR ?? 0),
      fundingCategories: categories,
      primaryCategory: categories[0]?.label ?? "Unspecified",
      group: mpoCounties.has(county) ? "8-county MPO" : "5-county non-MPO",
    },
  });
}

features.sort((a, b) => b.properties.estimatedConstruction - a.properties.estimatedConstruction);

const collection = {
  type: "FeatureCollection",
  bbox,
  features,
  metadata: {
    name: "TxDOT Projects Info - H-GAC subset",
    generatedAt: new Date().toISOString(),
    featureCount: features.length,
    source: "GIS/TxDOT_Projects_Info.shp",
  },
};

await mkdir("public/data", { recursive: true });
await writeFile("public/data/hgac-projects.geojson", JSON.stringify(collection));

console.log(`Wrote ${features.length} features to public/data/hgac-projects.geojson`);
