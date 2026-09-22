export type ToggleQueue = {
  enqueue<T>(objectId: string, task: () => Promise<T>): Promise<T>;
};

export function createToggleQueue(): ToggleQueue {
  const chains = new Map<string, Promise<void>>();

  return {
    enqueue<T>(objectId: string, task: () => Promise<T>): Promise<T> {
      const previous = chains.get(objectId) ?? Promise.resolve();
      const result = previous.catch(() => undefined).then(task);
      const tail = result.then(
        () => undefined,
        () => undefined
      );
      chains.set(objectId, tail);
      void tail.then(() => {
        if (chains.get(objectId) === tail) {
          chains.delete(objectId);
        }
      });
      return result;
    }
  };
}
