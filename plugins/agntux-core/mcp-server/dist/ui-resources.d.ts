interface ResourceContents {
    uri: string;
    mimeType: string;
    text: string;
    _meta: Record<string, unknown>;
}
interface ResourceResponse {
    contents: ResourceContents[];
}
interface StructuredError {
    isError: true;
    contents: Array<{
        type: "text";
        text: string;
    }>;
}
export declare function handleUIResource(uri: string): Promise<ResourceResponse | StructuredError>;
export declare const UI_RESOURCE_LIST: Array<{
    uri: string;
    name: string;
    mimeType: string;
}>;
export {};
