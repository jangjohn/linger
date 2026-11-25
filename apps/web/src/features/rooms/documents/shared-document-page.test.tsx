import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { requestUrlText } from "@linger/service-kit";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  createHttpTeamHubClient,
  type TeamHubClient,
} from "@/features/teamhub/teamhub-client";
import { TeamHubTestServer } from "@/test/teamhub-test-server";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { SharedDocumentPage } from "./shared-document-page";

afterEach(cleanup);
const token = `doc_link_${"a".repeat(43)}`;
function renderPage(
  role: "viewer" | "editor",
  readOnly = false,
  downloadError?: unknown,
) {
  const download = vi.fn();
  if (downloadError) download.mockRejectedValue(downloadError);
  else
    download.mockResolvedValue({
      documentId: "doc-1",
      versionId: "version-1",
      filename: "shared.txt",
      representationFormat: "plain_text",
      readOnly,
      access: { role },
      mediaType: "text/plain",
      blob: { size: 11, text: async () => "initial text" },
    });
  const uploadDocumentVersion = vi
    .fn()
    .mockRejectedValue(new Error("Link revoked"));
  const server = new TeamHubTestServer().on("GET", "/v0/session", () => ({
    account_id: "account-1",
  }));
  const client = {
    api: createHttpTeamHubClient({
      fetchRequest: server.fetch,
      onAuthenticationRequired: () => undefined,
    }).api,
    documentLinks: { download },
    uploadDocumentVersion,
  } as unknown as TeamHubClient;
  const router = createMemoryRouter(
    [{ path: "/shared-documents", element: <SharedDocumentPage /> }],
    { initialEntries: [`/shared-documents#${token}`] },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider
        runtime={{
          client,
          runStatuses: { subscribe: () => () => undefined },
          events: {
            subscribeRoom: () => () => undefined,
            subscribeSignals: () => () => undefined,
          },
        }}
      >
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return { download, uploadDocumentVersion };
}

it.each([
  ["viewer", false],
  ["editor", true],
] as const)("keeps %s native=%s content read only", async (role, native) => {
  renderPage(role, native);
  expect(await screen.findByText("initial text")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(screen.queryByLabelText("Upload version")).toBeNull();
});

it("saves with the exact downloaded base and capability, preserving edits on revocation", async () => {
  const { uploadDocumentVersion } = renderPage("editor");
  const editor = await screen.findByRole("textbox", { name: "File content" });
  fireEvent.change(editor, { target: { value: "changed text" } });
  expect(screen.getByRole("button", { name: "Refresh file" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(uploadDocumentVersion).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({
        expectedCurrentVersionId: "version-1",
        linkToken: token,
        representationFormat: "plain_text",
      }),
      expect.any(String),
    ),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Link revoked");
  expect(editor).toHaveValue("changed text");
});

it.each([
  [
    new TeamHubError({
      code: "NOT_FOUND",
      message: "link missing",
      status: 404,
    }),
    "This link is unavailable or has been revoked.",
  ],
  [
    new TeamHubError({
      code: "FORBIDDEN",
      message: "Access denied",
      status: 403,
    }),
    "Access denied",
  ],
])("shows the matching download failure text", async (error, text) => {
  renderPage("viewer", false, error);
  expect(await screen.findByRole("alert")).toHaveTextContent(text);
});

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

it.each([
  ["ASCII title via X-Document-Filename", "WIN015-DOC-TITLE.md"],
  ["UTF-8 CJK title via X-Document-Filename", "\u4e2d\u6587\u6587\u6863.md"],
])(
  "displays the real document title in the shared page header for %s",
  async (_label, title) => {
    const body = new TextEncoder().encode("# Shared body\n");
    const contentHeaders: Record<string, string> = {
      "Content-Type": "text/markdown",
      "Content-Disposition": `attachment; filename="document.md"; filename*=utf-8''${encodeURIComponent(title)}`,
      "X-Document-Id": "doc-1",
      "X-Document-Version-Id": "version-1",
      "X-Document-Filename": encodeBase64Url(title),
      "X-Document-Representation-Format": "markdown",
      "X-Document-Read-Only": "true",
      "X-Content-Sha256": bytesToHex(sha256(body)),
    };

    const fetchRequest = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrlText(input);
      if (url.endsWith("/v0/session"))
        return Response.json(
          { error: { code: "UNAUTHENTICATED", message: "Anonymous" } },
          { status: 401 },
        );
      if (url.endsWith("/v0/shared-documents/resolve"))
        return Response.json({
          link_id: "link-1",
          document_id: "doc-1",
          tenant_id: "tenant-1",
          role: "viewer",
          version: 1,
        });
      if (url.endsWith("/v0/shared-documents/content"))
        return new Response(body, { headers: contentHeaders });
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = createHttpTeamHubClient({
      baseUrl: "https://web.test/",
      fetchRequest,
      onAuthenticationRequired: () => undefined,
    });
    const router = createMemoryRouter(
      [{ path: "/shared-documents", element: <SharedDocumentPage /> }],
      { initialEntries: [`/shared-documents#${token}`] },
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TeamHubRuntimeProvider
          runtime={{
            client,
            runStatuses: { subscribe: () => () => undefined },
            events: {
              subscribeRoom: () => () => undefined,
              subscribeSignals: () => () => undefined,
            },
          }}
        >
          <RouterProvider router={router} />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    expect(await screen.findByText("# Shared body")).toBeVisible();
  },
);
