import type {
  BrowserConnectionInfo,
  DomSnapshotResult
} from "../shared/ipc.js";
import {
  normalizeChromePageUrl,
  type ChromeLaunchErrorCode,
  type ChromeLaunchProgressStage,
  type OpenChromePageProgress,
  type OpenChromePageRequest,
  type OpenChromePageResult
} from "../shared/chromeLaunch.js";
import type { ChromeEndpointResolution } from "./chromeInstanceManager.js";
import { ChromeExecutableError } from "./chromeExecutable.js";

type ChromePageWorkflowOptions = {
  instances: {
    resolveEndpoint: (
      preferredEndpoint: string | undefined,
      onProgress: (stage: ChromeLaunchProgressStage, endpoint?: string) => void
    ) => Promise<ChromeEndpointResolution>;
  };
  testPages: {
    resolve: (id: string) => Promise<string>;
  };
  session: {
    createAndSelectTarget: (
      endpoint: string,
      url: string
    ) => Promise<{
      connection: BrowserConnectionInfo;
      snapshot: DomSnapshotResult;
      bootstrapTargetIds: string[];
    }>;
    closeTarget: (targetId: string) => Promise<void>;
  };
};

export class ChromePageWorkflow {
  constructor(private readonly options: ChromePageWorkflowOptions) {}

  async open(
    request: OpenChromePageRequest,
    emit: (progress: OpenChromePageProgress) => void
  ): Promise<OpenChromePageResult> {
    try {
      const url = await this.resolveSource(request);
      const endpoint = await this.options.instances.resolveEndpoint(
        request.preferredEndpoint,
        (stage, progressEndpoint) =>
          emit({
            requestId: request.requestId,
            stage,
            ...(progressEndpoint ? { endpoint: progressEndpoint } : {})
          })
      );
      if (endpoint.status === "cancelled") {
        return endpoint;
      }
      emit({
        requestId: request.requestId,
        stage: "opening",
        endpoint: endpoint.endpoint
      });
      const created = await this.options.session.createAndSelectTarget(
        endpoint.endpoint,
        url
      );
      if (endpoint.launched) {
        for (const bootstrapTargetId of created.bootstrapTargetIds) {
          await this.options.session.closeTarget(bootstrapTargetId);
        }
      }
      const targetId = created.connection.targetId;
      if (!targetId) {
        throw new ChromeExecutableError("target-attach-failed");
      }
      return {
        status: "opened",
        ownership: endpoint.ownership,
        endpoint: endpoint.endpoint,
        targetId,
        connection: created.connection,
        snapshot: created.snapshot
      };
    } catch (error) {
      return {
        status: "error",
        code: readErrorCode(error),
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async resolveSource(request: OpenChromePageRequest): Promise<string> {
    if (request.source.kind === "test-page") {
      try {
        return await this.options.testPages.resolve(request.source.id);
      } catch {
        throw new ChromeExecutableError("test-server-failed");
      }
    }
    const normalized = normalizeChromePageUrl(request.source.value);
    if (!normalized.ok) {
      throw new ChromeExecutableError(normalized.code);
    }
    return normalized.url;
  }
}

function readErrorCode(error: unknown): ChromeLaunchErrorCode {
  return error instanceof ChromeExecutableError
    ? error.code
    : "target-create-failed";
}
