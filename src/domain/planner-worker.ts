import { planRoutes, RoutingError } from './routing';
import type { PlannerMessage, PlannerResponse } from './planner-client';
import type { CityDataset } from './types';

let data: CityDataset | undefined;
let initializationError: string | undefined;
self.onmessage = (event: MessageEvent<PlannerMessage>) => {
  const message = event.data;
  if (message.type === 'init') {
    try {
      if (
        !message.data?.manifest ||
        !Array.isArray(message.data.nodes) ||
        !Array.isArray(message.data.edges) ||
        !Array.isArray(message.data.cells)
      )
        throw new Error(
          'The coverage package is incomplete. Reload the coverage area.',
        );
      data = message.data;
      initializationError = undefined;
    } catch (error) {
      data = undefined;
      initializationError =
        error instanceof Error
          ? error.message
          : 'Could not initialize the coverage package.';
    }
    return;
  }
  let response: PlannerResponse;
  try {
    if (!data)
      throw new RoutingError(
        'INITIALIZATION_FAILED',
        initializationError ??
          'Load a coverage package before planning a route.',
      );
    response = {
      type: 'success',
      id: message.id,
      result: planRoutes(data, message.request),
    };
  } catch (error) {
    response = {
      type: 'error',
      id: message.id,
      code: error instanceof RoutingError ? error.code : 'PLANNING_FAILED',
      message:
        error instanceof Error
          ? error.message
          : 'Route planning failed. Try different endpoints.',
    };
  }
  self.postMessage(response);
};
