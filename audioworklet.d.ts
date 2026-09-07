interface AudioWorkletProcessor {
    readonly port: MessagePort;
}

interface AudioWorkletProcessorConstructor {
    new (options?: AudioWorkletNodeOptions): AudioWorkletProcessorImpl;
}

interface AudioWorkletProcessorImpl extends AudioWorkletProcessor {
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>,
    ): boolean;
}

declare const AudioWorkletProcessor: AudioWorkletProcessorConstructor;

declare function registerProcessor(name: string, processorCtor: Function): void;
