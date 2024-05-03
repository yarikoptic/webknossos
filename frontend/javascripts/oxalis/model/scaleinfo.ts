import { LengthUnitsMap } from "libs/format_utils";
import { map3 } from "libs/utils";
import { LengthUnit, type Vector3 } from "oxalis/constants";
import { DatasetScale } from "types/api_flow_types";

export function datasetScaleFactorToNm(datasetScale: DatasetScale): Vector3 {
  const conversionToNmFactor = LengthUnitsMap[datasetScale.unit] / LengthUnitsMap[LengthUnit.nm];
  return map3((factor) => factor * conversionToNmFactor, datasetScale.factor);
}

export function getBaseVoxelInDatasourceUnit(datasetScaleFactor: Vector3): number {
  // base voxel should be a cube with highest resolution
  return Math.min(...datasetScaleFactor);
}

export function getBaseVoxelInNm(datasetScale: DatasetScale): number {
  // base voxel should be a cube with highest resolution
  const scaleFactorInNm = datasetScaleFactorToNm(datasetScale);
  return getBaseVoxelInDatasourceUnit(scaleFactorInNm);
}

export function voxelToNm3(datasetScale: DatasetScale, mag: Vector3, volumeInVx: number): number {
  const scaleFactorInNm = datasetScaleFactorToNm(datasetScale);
  return (
    mag[0] *
    mag[1] *
    mag[2] *
    scaleFactorInNm[0] *
    scaleFactorInNm[1] *
    scaleFactorInNm[2] *
    volumeInVx
  );
}

// TODO: check whether this function semantically makes sense or whether only getBaseVoxelFactorsInDatasetResolution is needed / makes sense.
export function getBaseVoxelFactorsInNm(datasetScale: DatasetScale): Vector3 {
  // base voxel should be a cube with highest resolution
  const baseVoxel = getBaseVoxelInDatasourceUnit(datasetScale.factor);
  const scaleFactorInNm = datasetScaleFactorToNm(datasetScale);
  // scale factor to calculate the voxels in a certain
  // dimension from baseVoxels
  return [
    baseVoxel / scaleFactorInNm[0],
    baseVoxel / scaleFactorInNm[1],
    baseVoxel / scaleFactorInNm[2],
  ];
}
export function getBaseVoxelFactorsInDatasourceUnit(datasetScale: DatasetScale): Vector3 {
  const scaleFactor = datasetScale.factor;
  // base voxel should be a cube with highest resolution
  const baseVoxel = getBaseVoxelInDatasourceUnit(scaleFactor);
  // scale factor to calculate the voxels in a certain
  // dimension from baseVoxels
  return [baseVoxel / scaleFactor[0], baseVoxel / scaleFactor[1], baseVoxel / scaleFactor[2]];
}

export function getVoxelPerNm(datasetScale: DatasetScale): Vector3 {
  const voxelPerNM = [0, 0, 0] as Vector3;
  const scaleFactorInNm = datasetScaleFactorToNm(datasetScale);

  for (let i = 0; i < 3; i++) {
    voxelPerNM[i] = 1 / scaleFactorInNm[i];
  }

  return voxelPerNM;
}

function voxelScaledToUnit(scale: Vector3, posArray: Vector3): Vector3 {
  const result = [0, 0, 0] as Vector3;

  for (let i = 0; i < 3; i++) {
    result[i] = posArray[i] * scale[i];
  }

  return result;
}

export function voxelToNm(datasetScale: DatasetScale, posArray: Vector3): Vector3 {
  const scaleFactorInNm = datasetScaleFactorToNm(datasetScale);
  return voxelScaledToUnit(scaleFactorInNm, posArray);
}

export function voxelToDatasourceUnit(datasetScale: DatasetScale, posArray: Vector3): Vector3 {
  return voxelScaledToUnit(datasetScale.factor, posArray);
}
