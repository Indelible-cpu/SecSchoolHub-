declare module 'mammoth/mammoth.browser.min.js' {
  const mammoth: {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{
      value: string;
      messages?: Array<{ type: string; message: string }>;
    }>;
  };
  export default mammoth;
}
