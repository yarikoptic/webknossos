// @flow
import type { ServerVolumeTracing, APIAnnotation } from "types/api_flow_types";

export const tracing: ServerVolumeTracing = {
  typ: "Volume",
  activeSegmentId: 10000,
  boundingBox: { topLeft: { x: 0, y: 0, z: 0 }, width: 10240, height: 10240, depth: 10240 },
  userBoundingBoxes: [],
  segments: [],
  createdTimestamp: 1529066010230,
  dataSetName: "ROI2017_wkw",
  editPosition: { x: 3904, y: 4282, z: 2496 },
  editRotation: { x: 0, y: 0, z: 0 },
  elementClass: "uint16",
  id: "segmentation",
  largestSegmentId: 21890,
  version: 0,
  zoomLevel: 0,
  resolutions: [
    { x: 1, y: 1, z: 1 },
    { x: 2, y: 2, z: 2 },
    { x: 4, y: 4, z: 4 },
    { x: 8, y: 8, z: 8 },
    { x: 16, y: 16, z: 16 },
    { x: 32, y: 32, z: 32 },
  ],
};

export const annotation: APIAnnotation = {
  description: "",
  state: "Active",
  id: "598b52293c00009906f043e7",
  visibility: "Internal",
  modified: 1529066010230,
  name: "",
  typ: "Explorational",
  task: null,
  stats: {},
  restrictions: { allowAccess: true, allowUpdate: true, allowFinish: true, allowDownload: true },
  formattedHash: "f043e7",
  annotationLayers: [
    {
      name: "volume",
      tracingId: "tracingId-1234",
      typ: "Volume",
    },
  ],
  dataSetName: "ROI2017_wkw",
  organization: "Connectomics Department",
  dataStore: {
    name: "localhost",
    url: "http://localhost:9000",
    isScratch: false,
    isForeign: false,
    isConnector: false,
    allowsUpload: true,
  },
  tracingStore: { name: "localhost", url: "http://localhost:9000" },
  settings: {
    allowedModes: ["volume"],
    branchPointsAllowed: true,
    somaClickingAllowed: true,
    resolutionRestrictions: {},
  },
  tags: ["ROI2017_wkw", "volume"],
  tracingTime: 0,
  meshes: [],
};
