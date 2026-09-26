import { PublishInput, PublishOutput } from '../../shared/step-functions';

export const handler = async (event: PublishInput): Promise<PublishOutput> => {
  return {
    caseId: event.caseId,
    publishedUrl: `https://panch.example/rulings/${event.caseId}`,
  };
};
