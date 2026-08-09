import { ModelRuntime } from "@earendil-works/pi-coding-agent";

async function run() {
  const rt = await ModelRuntime.create();
  console.log(await rt.getAvailable());
}
run();
