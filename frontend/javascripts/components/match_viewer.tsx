import _ from "lodash";
import React, { useRef, useState, useEffect } from "react";
import { useFetch, useInterval } from "libs/react_helpers";
import { InputNumber, Slider, Spin, Switch } from "antd";
import { AsyncButton } from "./async_clickables";
import Deferred from "libs/async/deferred";
import memoizeOne from "memoize-one";
import { useDebounce } from "libs/react_hooks";

const SCALE = 0.4;
const TILE_EXTENT = [1536, 1024];
const SCALED_TILE_EXTENT = [SCALE * TILE_EXTENT[0], SCALE * TILE_EXTENT[1]];
const CANVAS_EXTENT = [2 * SCALED_TILE_EXTENT[0], SCALED_TILE_EXTENT[1]];

function _getFullImagesForMatch(tilePairIndex: number) {
  const img1 = new Image();
  const deferred1 = new Deferred();
  img1.onload = () => deferred1.resolve(img1);
  img1.src = `http://localhost:8000/full_image?tile_pair_index=${tilePairIndex}&partner_index=0`;

  const img2 = new Image();
  const deferred2 = new Deferred();
  img2.onload = () => deferred2.resolve(img2);
  img2.src = `http://localhost:8000/full_image?tile_pair_index=${tilePairIndex}&partner_index=1`;

  return Promise.all([deferred1.promise(), deferred2.promise()]);
}

const getFullImagesForMatch = memoizeOne(_getFullImagesForMatch);

const ImageWithSpinner = ({ src, ...props }: { src: string }) => {
  const [isLoading, setIsLoading] = useState(true);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const imgElement = imgRef.current;

    const handleLoad = () => {
      setIsLoading(false);
    };

    if (imgElement && imgElement.complete) {
      setIsLoading(false);
    } else if (imgElement) {
      setIsLoading(true);
      imgElement.addEventListener("load", handleLoad);
    }

    return () => {
      if (imgElement) {
        imgElement.removeEventListener("load", handleLoad);
      }
    };
  }, [src]);

  return (
    <>
      <Spin spinning={isLoading}>
        <img ref={imgRef} src={src} {...props} />
      </Spin>
    </>
  );
};

export function MatchViewer() {
  const canvasRef = useRef<any>(null);
  const width = CANVAS_EXTENT[0];
  const height = CANVAS_EXTENT[1];

  const [maxDistance, setMaxDistance] = useState(100);
  const [hoveredMatchIndex, setHoveredMatchIndex] = useState(0);
  const [info_refresher, set_info_refresher] = useState(0);
  const refetch_info = () => set_info_refresher(info_refresher + 1);
  const [partnerIndex, setPartnerIndex] = useState(0);
  const [tilePairIndex, setTilePairIndex] = useState(0);
  const [showOriginalMatches, setShowOriginalMatches] = useState(true);
  const [useFlann, setUseFlann] = useState(false);
  const debouncedMaxDistance = useDebounce(maxDistance, 1000);
  const onChangeTilePairIndex = (value: number | null) => {
    if (value != null) {
      setTilePairIndex(value);
    }
    setUseFlann(false);
  };

  const params = new URLSearchParams();
  params.append("tile_pair_index", `${tilePairIndex}`);
  params.append("use_flann", useFlann ? "true" : "false");
  params.append("show_original_matches", showOriginalMatches ? "true" : "false");
  params.append("max_distance", `${debouncedMaxDistance}`);
  const paramStr = `${params}`;

  const rematch = async () => {
    await fetch(`http://localhost:8000/rematch?${paramStr}`);
    setUseFlann(true);
    refetch_info();
  };

  useInterval(() => {
    setPartnerIndex((partnerIndex + 1) % 2);
  }, 500);

  const info = useFetch(
    async () => {
      return fetch(`http://localhost:8000/info?${paramStr}`).then((res) => res.json());
    },
    null,
    [paramStr, info_refresher],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == null) {
      return;
    }
    const context = canvas.getContext("2d");

    context.clearRect(0, 0, canvas.width, canvas.height);

    // const DRAW_TRIANGLES = false;
    // if (DRAW_TRIANGLES) {
    //   for (const tileIdx of [0, 1]) {
    //     let [x1, y1, x2, y2] = info.tiles[tileIdx].rect;
    //     x1 = Math.ceil((x1 / info.section_shape[0]) * width);
    //     x2 = Math.ceil((x2 / info.section_shape[0]) * width);
    //     y1 = Math.ceil((y1 / info.section_shape[1]) * height);
    //     y2 = Math.ceil((y2 / info.section_shape[1]) * height);

    //     // Generate a distinct color for each rectangle
    //     context.fillStyle = `hsla(${tileIdx * 36}, 70%, 60%, 70%)`;

    //     // Draw the rectangle
    //     context.fillRect(x1, y1, x2 - x1, y2 - y1);
    //   }
    // }

    getFullImagesForMatch(tilePairIndex).then(([img1, img2]) => {
      // const image1 = document.getElementById("full-image-1");
      // if (image1) {
      const image1 = img1;
      const image2 = img2;
      context.drawImage(image1, 0, 0, SCALED_TILE_EXTENT[0], SCALED_TILE_EXTENT[1]);
      context.drawImage(
        image2,
        SCALED_TILE_EXTENT[0],
        0,
        SCALED_TILE_EXTENT[0],
        SCALED_TILE_EXTENT[1],
      );

      // const dst = info.keypoints[1][0]
      context.strokeStyle = "blue";

      const src = info.keypoints[0][hoveredMatchIndex];
      const CUTOUT_SIZE = SCALE * 100;
      context.beginPath();
      console.log("draw rect");
      context.rect(
        SCALE * src[0] - CUTOUT_SIZE / 2,
        SCALE * src[1] - CUTOUT_SIZE / 2,
        CUTOUT_SIZE,
        CUTOUT_SIZE,
      );
      context.stroke();

      context.beginPath();
      const dst = info.keypoints[1][hoveredMatchIndex];
      console.log("draw rect");
      context.rect(
        SCALED_TILE_EXTENT[0] + SCALE * dst[0] - CUTOUT_SIZE / 2,
        SCALE * dst[1] - CUTOUT_SIZE / 2,
        CUTOUT_SIZE,
        CUTOUT_SIZE,
      );
      context.stroke();
    });
  }, [info, tilePairIndex, info_refresher, hoveredMatchIndex]);

  // console.log("info", info);
  if (info == null) {
    return null;
  }
  const { feature_distances } = info;

  const feature_count = feature_distances.length;

  feature_distances.sort((a, b) => a - b);

  const sortedIndices = _.sortBy(
    feature_distances.map((value, index) => ({ value, index })),
    "value",
  ).map((item) => item.index);

  const matchImages = _.range(0, Math.min(20, feature_count))
    .filter((idx) => sortedIndices[idx] != null)
    .map((idx) => {
      const matchIdx = sortedIndices[idx];
      const src = info.keypoints[0][matchIdx];
      const dst = info.keypoints[1][matchIdx];
      return (
        <div key={matchIdx} style={{ textAlign: "center" }}>
          {/*<img
            style={{ border: `1px ${matchIdx === hoveredMatchIndex ? "blue" : "white"} solid` }}
            onMouseEnter={() => setHoveredMatchIndex(matchIdx)}
            src={`http://localhost:8000/match_image?${paramStr}&feature_index=${matchIdx}&partner_index=${partnerIndex}`}
          />*/}
          <ImageWithSpinner
            src={`http://localhost:8000/match_image?${paramStr}&feature_index=${matchIdx}&partner_index=${partnerIndex}`}
            style={{ border: `1px ${matchIdx === hoveredMatchIndex ? "blue" : "white"} solid` }}
            onMouseEnter={() => setHoveredMatchIndex(matchIdx)}
          />
          <div>Score: {Math.round(feature_distances[matchIdx])}</div>
          <div>
            Distance: {Math.round(((src[0] - dst[0]) ** 2 + (src[1] - dst[1]) ** 2) ** 0.5)}
          </div>
        </div>
      );
    });

  return (
    <div>
      <Switch checked={showOriginalMatches} onChange={(bool) => setShowOriginalMatches(bool)} />{" "}
      Original Matches
      {!showOriginalMatches && (
        <span>
          <Switch
            style={{ marginLeft: 8 }}
            checked={useFlann}
            onChange={(bool) => setUseFlann(bool)}
          />{" "}
          FLANN
        </span>
      )}
      {!showOriginalMatches && !useFlann && (
        <div style={{ display: "flex" }}>
          Max Distance:{" "}
          <Slider
            step={10}
            value={maxDistance}
            onChange={setMaxDistance}
            style={{ width: "50%" }}
            max={500}
          />
          <div>{maxDistance}</div>
        </div>
      )}
      {/*<AsyncButton onClick={() => rematch()}>Rematch</AsyncButton>*/}
      <div style={{ textAlign: "center" }}>
        <canvas ref={canvasRef} width={CANVAS_EXTENT[0]} height={CANVAS_EXTENT[1]} />
        <div style={{ marginBottom: 12 }}>
          <InputNumber value={tilePairIndex} min={0} max={100} onChange={onChangeTilePairIndex} />
          {info.tiles[0].indices.join("-")} vs {info.tiles[1].indices.join("-")}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridGap: "1rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        }}
      >
        {matchImages}
      </div>
    </div>
  );
}
