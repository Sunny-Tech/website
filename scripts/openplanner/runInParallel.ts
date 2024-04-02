type RunFunction<T, R> = (data: T | undefined) => Promise<R>;

export const runInParallel = async <T, R>(
  dataList: T[] = [],
  numberOfParallelRequest: number,
  runFunction: RunFunction<T, R>
): Promise<R[]> => {
  return new Promise((resolve, reject) => {
    const queue = [...dataList];
    const results = new Array(dataList.length);
    let completedCount = 0;

    const processNext = async (index: number) => {
      while (queue.length > 0) {
        const dataIndex = dataList.length - queue.length;
        const dataEl = queue.shift();
        try {
          results[dataIndex] = await runFunction(dataEl);
        } catch (error) {
          console.error(`Error in Run ${index}:`, error);
          results[dataIndex] = undefined;
        }

        completedCount++;
        if (completedCount === dataList.length) {
          resolve(results);
          return;
        }
      }
    };

    const parallelRequests = Math.min(numberOfParallelRequest, dataList.length);
    console.log(`Running ${parallelRequests} parallel requests`);

    if(parallelRequests === 0) {
      resolve([]);
      console.log('No parallel requests to run');
      return;
    }

    for (let i = 0; i < parallelRequests; i++) {
      processNext(i).catch(reject);
    }
  });
};
