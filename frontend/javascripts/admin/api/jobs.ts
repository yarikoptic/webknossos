import Request from "libs/request";
import { location } from "libs/window";
import type { Vector3, Vector6 } from "oxalis/constants";
import type {
  APIAnnotationType,
  APIJob,
  APIJobCeleryState,
  APIJobManualState,
  APIJobState,
  AiModel,
  RenderAnimationOptions,
} from "types/api_flow_types";
import { assertResponseLimit } from "./api_utils";

export async function getJobs(): Promise<APIJob[]> {
  const jobs = await Request.receiveJSON("/api/jobs");
  assertResponseLimit(jobs);
  return (
    jobs
      .map(
        (job: any): APIJob => ({
          id: job.id,
          type: job.command,
          datasetName: job.commandArgs.dataset_name,
          organizationName: job.commandArgs.organization_name,
          layerName: job.commandArgs.layer_name || job.commandArgs.volume_layer_name,
          annotationLayerName: job.commandArgs.annotation_layer_name,
          boundingBox: job.commandArgs.bbox,
          exportFileName: job.commandArgs.export_file_name,
          tracingId: job.commandArgs.volume_tracing_id,
          annotationId: job.commandArgs.annotation_id,
          annotationType: job.commandArgs.annotation_type,
          mergeSegments: job.commandArgs.merge_segments,
          state: adaptJobState(job.state, job.manualState),
          manualState: job.manualState,
          result: job.returnValue,
          resultLink: job.resultLink,
          createdAt: job.created,
        }),
      )
      // Newest jobs should be first
      .sort((a: APIJob, b: APIJob) => a.createdAt > b.createdAt)
  );
}

export async function getJob(jobId: string): Promise<APIJob> {
  const job = await Request.receiveJSON(`/api/jobs/${jobId}`);
  return {
    id: job.id,
    type: job.command,
    datasetName: job.commandArgs.dataset_name,
    organizationName: job.commandArgs.organization_name,
    layerName: job.commandArgs.layer_name || job.commandArgs.volume_layer_name,
    annotationLayerName: job.commandArgs.annotation_layer_name,
    boundingBox: job.commandArgs.bbox,
    exportFileName: job.commandArgs.export_file_name,
    tracingId: job.commandArgs.volume_tracing_id,
    annotationId: job.commandArgs.annotation_id,
    annotationType: job.commandArgs.annotation_type,
    mergeSegments: job.commandArgs.merge_segments,
    state: adaptJobState(job.state, job.manualState),
    manualState: job.manualState,
    result: job.returnValue,
    resultLink: job.resultLink,
    createdAt: job.created,
  };
}

function adaptJobState(
  celeryState: APIJobCeleryState,
  manualState: APIJobManualState,
): APIJobState {
  if (manualState) {
    return manualState;
  }

  return celeryState || "UNKNOWN";
}

export async function cancelJob(jobId: string): Promise<APIJob> {
  return Request.receiveJSON(`/api/jobs/${jobId}/cancel`, {
    method: "PATCH",
  });
}

export async function startConvertToWkwJob(
  datasetName: string,
  organizationName: string,
  scale: Vector3,
): Promise<APIJob> {
  return Request.receiveJSON(
    `/api/jobs/run/convertToWkw/${organizationName}/${datasetName}?scale=${scale.toString()}`,
    {
      method: "POST",
    },
  );
}

export async function startFindLargestSegmentIdJob(
  datasetName: string,
  organizationName: string,
  layerName: string,
): Promise<APIJob> {
  return Request.receiveJSON(
    `/api/jobs/run/findLargestSegmentId/${organizationName}/${datasetName}?layerName=${layerName}`,
    {
      method: "POST",
    },
  );
}

export async function startExportTiffJob(
  datasetName: string,
  organizationName: string,
  bbox: Vector6,
  layerName: string | null | undefined,
  mag: string | null | undefined,
  annotationId: string | null | undefined,
  annotationLayerName: string | null | undefined,
  asOmeTiff: boolean,
): Promise<APIJob> {
  const params = new URLSearchParams({ bbox: bbox.join(","), asOmeTiff: asOmeTiff.toString() });
  if (layerName != null) {
    params.append("layerName", layerName);
  }
  if (mag != null) {
    params.append("mag", mag);
  }
  if (annotationId != null) {
    params.append("annotationId", annotationId);
  }
  if (annotationLayerName != null) {
    params.append("annotationLayerName", annotationLayerName);
  }
  return Request.receiveJSON(
    `/api/jobs/run/exportTiff/${organizationName}/${datasetName}?${params}`,
    {
      method: "POST",
    },
  );
}

export function startComputeMeshFileJob(
  organizationName: string,
  datasetName: string,
  layerName: string,
  mag: Vector3,
  agglomerateView?: string,
): Promise<APIJob> {
  const params = new URLSearchParams();
  params.append("layerName", layerName);
  params.append("mag", mag.join("-"));

  if (agglomerateView) {
    params.append("agglomerateView", agglomerateView);
  }

  return Request.receiveJSON(
    `/api/jobs/run/computeMeshFile/${organizationName}/${datasetName}?${params}`,
    {
      method: "POST",
    },
  );
}

export function startComputeSegmentIndexFileJob(
  organizationName: string,
  datasetName: string,
  layerName: string,
): Promise<APIJob> {
  const params = new URLSearchParams();
  params.append("layerName", layerName);

  return Request.receiveJSON(
    `/api/jobs/run/computeSegmentIndexFile/${organizationName}/${datasetName}?${params}`,
    {
      method: "POST",
    },
  );
}

export function startNucleiInferralJob(
  organizationName: string,
  datasetName: string,
  layerName: string,
  newDatasetName: string,
): Promise<APIJob> {
  return Request.receiveJSON(
    `/api/jobs/run/inferNuclei/${organizationName}/${datasetName}?layerName=${layerName}&newDatasetName=${newDatasetName}`,
    {
      method: "POST",
    },
  );
}

export function startNeuronInferralJob(
  organizationName: string,
  datasetName: string,
  layerName: string,
  bbox: Vector6,
  outputSegmentationLayerName: string,
  newDatasetName: string,
): Promise<APIJob> {
  const urlParams = new URLSearchParams({
    layerName,
    bbox: bbox.join(","),
    outputSegmentationLayerName,
    newDatasetName,
  });
  return Request.receiveJSON(
    `/api/jobs/run/inferNeurons/${organizationName}/${datasetName}?${urlParams.toString()}`,
    {
      method: "POST",
    },
  );
}

export function startRenderAnimationJob(
  organizationName: string,
  datasetName: string,
  animationOptions: RenderAnimationOptions,
): Promise<APIJob> {
  return Request.sendJSONReceiveJSON(
    `/api/jobs/run/renderAnimation/${organizationName}/${datasetName}`,
    {
      data: animationOptions,
    },
  );
}

function startSegmentationAnnotationDependentJob(
  jobURLPath: string,
  organizationName: string,
  datasetName: string,
  fallbackLayerName: string,
  volumeLayerName: string | null | undefined,
  newDatasetName: string,
  annotationId: string,
  annotationType: APIAnnotationType,
  outputSegmentationLayerName?: string,
  mergeSegments?: boolean,
): Promise<APIJob> {
  const requestURL = new URL(
    `/api/jobs/run/${jobURLPath}/${organizationName}/${datasetName}`,
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'Location' is not assignable to parameter of type 'string | URL | undefined'.
    location,
  );
  if (volumeLayerName != null) {
    requestURL.searchParams.append("volumeLayerName", volumeLayerName);
  }
  requestURL.searchParams.append("fallbackLayerName", fallbackLayerName);
  requestURL.searchParams.append("annotationId", annotationId);
  requestURL.searchParams.append("annotationType", annotationType);
  requestURL.searchParams.append("newDatasetName", newDatasetName);
  if (outputSegmentationLayerName != null) {
    requestURL.searchParams.append("outputSegmentationLayerName", outputSegmentationLayerName);
  }
  if (mergeSegments != null) {
    requestURL.searchParams.append("mergeSegments", mergeSegments.toString());
  }
  return Request.receiveJSON(requestURL.href, {
    method: "POST",
  });
}

export function startMaterializingVolumeAnnotationJob(
  organizationName: string,
  datasetName: string,
  fallbackLayerName: string,
  volumeLayerName: string | null | undefined,
  newDatasetName: string,
  outputSegmentationLayerName: string,
  annotationId: string,
  annotationType: APIAnnotationType,
  mergeSegments: boolean,
): Promise<APIJob> {
  return startSegmentationAnnotationDependentJob(
    "materializeVolumeAnnotation",
    organizationName,
    datasetName,
    fallbackLayerName,
    volumeLayerName,
    newDatasetName,
    annotationId,
    annotationType,
    outputSegmentationLayerName,
    mergeSegments,
  );
}

type AiModelCategory = "em_neurons" | "em_nuclei";

type RunTrainingParameters = {
  trainingAnnotationIds: Array<string>;
  trainingAnnotationColorLayerNames: Array<string>;
  name: string;
  comment?: string;
  aiModelCategory?: AiModelCategory;
  workflowYaml?: string;
};

export function runTraining(params: RunTrainingParameters) {
  return Request.sendJSONReceiveJSON("/api/aiModels/runTraining", {
    method: "POST",
    data: JSON.stringify(params),
  });
}

export function getAiModels(): Promise<AiModel[]> {
  return Request.receiveJSON("/api/aiModels");
}
