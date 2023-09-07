import type { OxalisState } from "oxalis/store";
import { defaultDatasetViewConfigurationWithoutNull } from "types/schemas/dataset_view_configuration.schema";
import { document } from "libs/window";
import Constants, {
  ControlModeEnum,
  OrthoViews,
  OverwriteModeEnum,
  FillModeEnum,
  TDViewDisplayModeEnum,
  InterpolationModeEnum,
} from "oxalis/constants";
import { APIAllowedMode, APIAnnotationType, APIAnnotationVisibility } from "types/api_flow_types";
const defaultViewportRect = {
  top: 0,
  left: 0,
  width: Constants.VIEWPORT_WIDTH,
  height: Constants.VIEWPORT_WIDTH,
};
const initialAnnotationInfo = {
  annotationId: "",
  restrictions: {
    branchPointsAllowed: false,
    allowUpdate: false,
    allowSave: false,
    allowFinish: false,
    allowAccess: true,
    allowDownload: false,
    somaClickingAllowed: false,
    mergerMode: false,
    volumeInterpolationAllowed: false,
    allowedModes: ["orthogonal", "oblique", "flight"] as APIAllowedMode[],
    resolutionRestrictions: {},
  },
  visibility: "Internal" as APIAnnotationVisibility,
  tags: [],
  description: "",
  name: "",
  tracingStore: {
    name: "localhost",
    url: "http://localhost:9000",
  },
  annotationType: "View" as APIAnnotationType,
  meshes: [],
};

const primaryStylesheetElement: HTMLLinkElement | null | undefined = document.getElementById(
  "primary-stylesheet",
) as HTMLLinkElement;
const defaultState: OxalisState = {
  datasetConfiguration: defaultDatasetViewConfigurationWithoutNull,
  userConfiguration: {
    autoSaveLayouts: true,
    autoRenderMeshInProofreading: true,
    brushSize: 50,
    clippingDistance: 50,
    clippingDistanceArbitrary: 64,
    crosshairSize: 0.1,
    displayCrosshair: true,
    displayScalebars: true,
    dynamicSpaceDirection: false,
    hideTreeRemovalWarning: false,
    highlightCommentedNodes: false,
    keyboardDelay: 200,
    mouseRotateValue: 0.004,
    moveValue3d: 300,
    moveValue: 300,
    newNodeNewTree: false,
    centerNewNode: true,
    overrideNodeRadius: true,
    particleSize: 5,
    presetBrushSizes: null,
    rotateValue: 0.01,
    sortCommentsAsc: true,
    sortTreesByName: false,
    sphericalCapRadius: Constants.DEFAULT_SPHERICAL_CAP_RADIUS,
    tdViewDisplayPlanes: TDViewDisplayModeEnum.DATA,
    tdViewDisplayDatasetBorders: true,
    tdViewDisplayLayerBorders: false,
    gpuMemoryFactor: Constants.DEFAULT_GPU_MEMORY_FACTOR,
    overwriteMode: OverwriteModeEnum.OVERWRITE_ALL,
    fillMode: FillModeEnum._2D,
    interpolationMode: InterpolationModeEnum.INTERPOLATE,
    useLegacyBindings: false,
    quickSelect: {
      useHeuristic: false,
      showPreview: false,
      segmentMode: "light",
      threshold: 128,
      closeValue: 3,
      erodeValue: 1,
      dilateValue: 2,
    },
    renderWatermark: true,
    antialiasRendering: false,
  },
  temporaryConfiguration: {
    viewMode: Constants.MODE_PLANE_TRACING,
    histogramData: {},
    flightmodeRecording: false,
    controlMode: ControlModeEnum.VIEW,
    mousePosition: null,
    hoveredSegmentId: 0,
    activeMappingByLayer: {},
    isMergerModeEnabled: false,
    gpuSetup: {
      smallestCommonBucketCapacity:
        Constants.GPU_FACTOR_MULTIPLIER * Constants.DEFAULT_GPU_MEMORY_FACTOR,
      initializedGpuFactor: Constants.GPU_FACTOR_MULTIPLIER,
      maximumLayerCountToRender: 32,
    },
    preferredQualityForMeshPrecomputation: 2,
    preferredQualityForMeshAdHocComputation: 2,
    lastVisibleSegmentationLayerName: null,
  },
  task: null,
  dataset: {
    name: "Test Dataset",
    folderId: "dummy-folder-id",
    isUnreported: false,
    created: 123,
    dataSource: {
      dataLayers: [],
      scale: [5, 5, 5],
      id: {
        name: "Test Dataset",
        team: "",
      },
    },
    details: null,
    tags: [],
    isPublic: false,
    isActive: true,
    isEditable: true,
    dataStore: {
      name: "localhost",
      url: "http://localhost:9000",
      isScratch: false,
      allowsUpload: true,
    },
    owningOrganization: "Connectomics department",
    description: null,
    displayName: "Awesome Test Dataset",
    allowedTeams: [],
    allowedTeamsCumulative: [],
    logoUrl: null,
    lastUsedByUser: 0,
    jobsEnabled: false,
    sortingKey: 123,
    publication: null,
  },
  tracing: {
    ...initialAnnotationInfo,
    readOnly: {
      userBoundingBoxes: [],
      boundingBox: null,
      createdTimestamp: 0,
      type: "readonly",
      version: 0,
      tracingId: "",
      additionalAxes: [],
    },
    volumes: [],
    mappings: [],
    skeleton: null,
    owner: null,
    contributors: [],
    othersMayEdit: false,
    blockedByUser: null,
    annotationLayers: [],
  },
  save: {
    queue: {
      skeleton: [],
      volumes: {},
      mappings: {},
    },
    isBusyInfo: {
      skeleton: false,
      volume: false,
      mapping: false,
    },
    lastSaveTimestamp: {
      skeleton: 0,
      volumes: {},
      mappings: {},
    },
    progressInfo: {
      processedActionCount: 0,
      totalActionCount: 0,
    },
  },
  flycam: {
    zoomStep: 1.3,
    currentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    spaceDirectionOrtho: [1, 1, 1],
    direction: [0, 0, 0],
    additionalCoordinates: [],
  },
  viewModeData: {
    plane: {
      activeViewport: OrthoViews.PLANE_XY,
      tdCamera: {
        near: 0,
        far: 0,
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        up: [0, 0, 0],
        lookAt: [0, 0, 0],
        position: [0, 0, 0],
      },
      inputCatcherRects: {
        PLANE_XY: defaultViewportRect,
        PLANE_YZ: defaultViewportRect,
        PLANE_XZ: defaultViewportRect,
        TDView: defaultViewportRect,
      },
    },
    arbitrary: {
      inputCatcherRect: defaultViewportRect,
    },
  },
  activeUser: null,
  activeOrganization: null,
  uiInformation: {
    activeTool: "MOVE",
    showDropzoneModal: false,
    showVersionRestore: false,
    showDownloadModal: false,
    showPythonClientModal: false,
    showAINucleiSegmentationModal: false,
    showAINeuronSegmentationModal: false,
    showShareModal: false,
    storedLayouts: {},
    isImportingMesh: false,
    isInAnnotationView: false,
    hasOrganizations: false,
    borderOpenStatus: {
      right: false,
      left: false,
    },
    theme: primaryStylesheetElement?.href.includes("dark.css") ? "dark" : "light",
    busyBlockingInfo: {
      isBusy: false,
    },
    quickSelectState: "inactive",
    areQuickSelectSettingsOpen: false,
  },
  localSegmentationData: {},
};
export default defaultState;
