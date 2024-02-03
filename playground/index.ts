import { asset, fetchWithProgress, AssetEvent } from "../src";

const image = asset(async (onProgress) =>
	fetchWithProgress("https://picsum.photos/200/300", {
		onProgress,
	}).then((res) => res.blob())
);

image.subscribe((event) => {
  switch(event) {
    case AssetEvent.PROGRESS:
      console.log("loading:", image.progress * 100, "%");
      break;
    case AssetEvent.LOADED:
      console.log("Loaded image", image.data);
      break;
    case AssetEvent.ERROR:
      console.error(image.error);
      break;
  }
})

image.load();

