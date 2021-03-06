// @flow
const debug = require('debug')(
  'api:mutations:community:change-default-payment-source'
);
import { replaceStripeCustomer } from '../../models/stripeCustomers';
import type { GraphQLContext } from '../../';
import UserError from '../../utils/UserError';
import { StripeUtil } from 'shared/stripe/utils';
import {
  isAuthedResolver as requireAuth,
  canAdministerCommunity,
} from '../../utils/permissions';
import { events } from 'shared/analytics';
import { trackQueue } from 'shared/bull/queues';

type Input = {
  input: {
    sourceId: string,
    communityId: string,
  },
};

export default requireAuth(async (_: any, args: Input, ctx: GraphQLContext) => {
  const { sourceId, communityId } = args.input;
  const { user, loaders } = ctx;

  const { customer, community } = await StripeUtil.jobPreflight(communityId);

  if (!community) {
    debug('Error getting community in preflight');

    trackQueue.add({
      userId: user.id,
      event: events.COMMUNITY_PAYMENT_SOURCE_MADE_DEFAULT_FAILED,
      context: { communityId },
      properties: {
        reason: 'community not fetched in preflight',
      },
    });

    return new UserError(
      'We had trouble processing this request - please try again later'
    );
  }

  if (!customer) {
    debug('Error creating customer in preflight');

    trackQueue.add({
      userId: user.id,
      event: events.COMMUNITY_PAYMENT_SOURCE_MADE_DEFAULT_FAILED,
      context: { communityId },
      properties: {
        reason: 'customer not fetched in preflight',
      },
    });

    return new UserError(
      'We had trouble processing this request - please try again later'
    );
  }

  if (!await canAdministerCommunity(user.id, communityId, loaders)) {
    trackQueue.add({
      userId: user.id,
      event: events.COMMUNITY_PAYMENT_SOURCE_MADE_DEFAULT_FAILED,
      context: { communityId },
      properties: {
        reason: 'no permission',
      },
    });

    return new UserError(
      'You must own this community to manage payment sources'
    );
  }

  const changeDefaultSource = async () =>
    await StripeUtil.changeDefaultSource({
      customerId: customer.id,
      sourceId: sourceId,
    });

  return changeDefaultSource()
    .then(async () => {
      trackQueue.add({
        userId: user.id,
        event: events.COMMUNITY_PAYMENT_SOURCE_MADE_DEFAULT,
        context: { communityId },
      });

      return await StripeUtil.getCustomer(customer.id);
    })
    .then(
      async newCustomer =>
        await replaceStripeCustomer(newCustomer.id, newCustomer)
    )
    .then(() => community);
});
