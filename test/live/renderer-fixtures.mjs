export const RENDERER_FIXTURES = [
  {
    name: 'sand_home',
    seed: 'A website that aggressively tries to sell absurd quantities of sand to apartment dwellers',
    renderPayload: {
      seed_phrase:
        'A website that aggressively tries to sell absurd quantities of sand to apartment dwellers',
      path: '/',
      page_type: 'landing',
      page_summary:
        'Front page for Grand Sand Supply Co., an aggressively persuasive storefront specializing in absurdly large sand deliveries for apartment dwellers, with prominent offers, product tiers, apartment-friendly planning tools, and links to ordering, delivery logistics, and sand care resources.',
      path_state_summary:
        'Visitor at the homepage of a sand-selling operation; no prior state established.',
      title:
        'Grand Sand Supply Co. — Sand for Apartments, Studios, and High-Rises',
      design_brief:
        'Create a loud, high-contrast commercial storefront with the tone of a relentless direct-response ad. The page should immediately push the visitor toward purchasing sand in comically excessive quantities while still offering practical-feeling details for apartment dwellers: elevator logistics, load-bearing notes, balcony warnings, building-manager scripts, and bulk pricing. Include a hero section with a splashy headline, a rotating-feel but static set of featured offers, a testimonials strip from bewildered tenants, a comparison table of sand volumes, and a prominent urgency panel with countdown-style language. Make the business feel real and inhabited, like a regional supplier with inventory, delivery windows, and customer support. The page should also contain helpful links to related areas such as a calculator, delivery map, FAQ, building approvals, and a sand library. Add one simple lead form for quotes and one reorder form for existing customers. Keep the layout dense and sales-driven, but sincere rather than parodying itself too hard.',
      links: [
        {
          href: '/catalog',
          label: 'Browse Sand Catalog',
          description:
            'See every grade, grain, and wildly oversized quantity currently available.',
        },
        {
          href: '/calculator',
          label: 'Apartment Sand Calculator',
          description:
            'Estimate how many bags, buckets, or bulk tons your home can responsibly absorb.',
        },
        {
          href: '/delivery',
          label: 'Delivery & Elevator Logistics',
          description:
            'Learn how we get sand into walk-ups, towers, and suspiciously small service entrances.',
        },
        {
          href: '/faq',
          label: 'Apartment Sand FAQ',
          description:
            'Answers about dust, pets, neighbors, leases, and why this keeps happening.',
        },
        {
          href: '/approvals',
          label: 'Building Approval Packet',
          description:
            'Printable notes for supers, managers, and any committee that asks questions.',
        },
        {
          href: '/samples',
          label: 'Sand Samples Counter',
          description:
            'Request a tiny sample kit before committing to a truly enormous order.',
        },
        {
          href: '/testimonials',
          label: 'Customer Praise Wall',
          description:
            'Read letters from tenants who have leaned into the sand lifestyle.',
        },
        {
          href: '/bulk',
          label: 'Bulk Deals & Freight',
          description:
            'View the most aggressive volume discounts and pallet pricing.',
        },
        {
          href: '/support',
          label: 'Support Desk',
          description:
            'Contact the order desk about returns, spills, and existential doubt.',
        },
        {
          href: '/newsletter',
          label: 'The Sand Bulletin',
          description:
            'Subscribe for delivery openings, seasonal specials, and limited apartment-grade offers.',
        },
      ],
      forms: [
        {
          formId: 'quote_request',
          method: 'GET',
          action: '/quote',
          purpose:
            'Request a custom sand quote for an apartment, loft, or other vertical dwelling.',
          submitLabel: 'Get My Sand Quote',
          fields: [
            {
              name: 'unit_type',
              label: 'Unit type',
              type: 'text',
              required: false,
              placeholder: 'studio, 1BR, penthouse, walk-up...',
            },
            {
              name: 'quantity',
              label: 'Desired quantity',
              type: 'text',
              required: false,
              placeholder: '25 bags, 2 tons, enough for the living room...',
            },
            {
              name: 'delivery_notes',
              label: 'Delivery notes',
              type: 'textarea',
              required: false,
              placeholder:
                'Freight elevator, rear alley, ask for Marla at the desk...',
            },
            {
              name: 'contact',
              label: 'Email or phone',
              type: 'text',
              required: false,
              placeholder: 'you@example.com',
            },
          ],
        },
        {
          formId: 'reorder',
          method: 'POST',
          action: '/reorder',
          purpose:
            'Quick reorder form for returning customers who need more sand immediately.',
          submitLabel: 'Reorder Now',
          fields: [
            {
              name: 'customer_id',
              label: 'Customer ID',
              type: 'text',
              required: false,
              placeholder: 'Optional account number',
            },
            {
              name: 'previous_order',
              label: 'Previous order reference',
              type: 'text',
              required: false,
              placeholder: 'Last invoice, pallet tag, or batch code',
            },
            {
              name: 'rush',
              label: 'Rush note',
              type: 'text',
              required: false,
              placeholder: 'Need it before the neighbors complain',
            },
          ],
        },
      ],
      interactive_requirement: {
        required: false,
        reason:
          'This is a storefront landing page; ordinary navigation and forms are sufficient without JavaScript.',
        behaviors: [],
      },
      renderer_scaffolding:
        'Server-owned scaffolding notes:\n\n- The local server injects hidden page-binding inputs into declared forms after validation.\n- The local server injects a small no-cache pageshow handler.\n- Keep the page self-contained and readable without external assets.\n- Give major interactive regions stable ids or data attributes so optional JavaScript has clear hooks.\n- Prefer semantic sections, obvious navigation blocks, and visible calls to action.\n',
    },
  },
  {
    name: 'jeff_home',
    seed: 'A social network where only people named Jeff are allowed to join. They take this requirement very very seriously',
    renderPayload: {
      seed_phrase:
        'A social network where only people named Jeff are allowed to join. They take this requirement very very seriously',
      path: '/',
      page_type: 'landing',
      page_summary:
        'The front door of a tightly controlled social network for people named Jeff. The page emphasizes the membership rule, explains the culture and enforcement process, and offers clear pathways to apply, verify, or learn the rules before proceeding.',
      path_state_summary:
        'At the site root. No prior state is established yet. Visitors have not been verified and must begin at the public landing page.',
      title: 'JeffNet — Members Only for Jeffs',
      design_brief:
        'A crisp, slightly official landing page with a security-forward social-network feel. Prominent headline, a stern but welcoming membership notice, and a short explanation of how the network verifies that each member is actually named Jeff. Include a featured news strip, a small ‘current Jeffs online’ tease, and a set of local navigation blocks leading to rules, the application, member directory preview, help center, and guestbook. The tone should be serious about the name requirement while still feeling like a real, bustling community site. Add a visible reminder that people with variants, nicknames, or almost-Jeff names are not accepted unless their legal name is Jeff. Include a footer with trust-and-safety style links and community standards.',
      links: [
        {
          href: '/about',
          label: 'About JeffNet',
          description:
            'Learn how the network works and why the name rule exists.',
        },
        {
          href: '/rules',
          label: 'Membership Rules',
          description:
            'The full Jeff-only policy, including verification standards and edge cases.',
        },
        {
          href: '/apply',
          label: 'Apply to Join',
          description:
            'Start the membership application and name verification process.',
        },
        {
          href: '/verify',
          label: 'Verify Your Name',
          description:
            'Check whether your name record is acceptable before you apply.',
        },
        {
          href: '/directory',
          label: 'Member Directory',
          description: 'Browse the public index of approved Jeffs.',
        },
        {
          href: '/news',
          label: 'Network News',
          description: 'Recent posts, announcements, and member updates.',
        },
        {
          href: '/events',
          label: 'Events Calendar',
          description: 'See upcoming meetups, chats, and Jeff-only gatherings.',
        },
        {
          href: '/help',
          label: 'Help Center',
          description:
            'Get answers about accounts, name changes, and invitations.',
        },
        {
          href: '/guestbook',
          label: 'Guestbook',
          description:
            'Leave a public note if you are in the process of becoming a Jeff.',
        },
        {
          href: '/faq',
          label: 'FAQ',
          description: 'Quick answers to the most common membership questions.',
        },
      ],
      forms: [
        {
          formId: 'name_check',
          method: 'GET',
          action: '/verify',
          purpose:
            'Quickly check whether a visitor’s name qualifies for membership.',
          submitLabel: 'Check Eligibility',
          fields: [
            {
              name: 'name',
              label: 'Legal first name',
              type: 'text',
              required: true,
              placeholder: 'Jeff',
            },
            {
              name: 'surname',
              label: 'Optional last name',
              type: 'text',
              required: false,
              placeholder: 'Any surname',
            },
          ],
        },
        {
          formId: 'apply_now',
          method: 'GET',
          action: '/apply',
          purpose:
            'Begin the formal application process for prospective Jeffs.',
          submitLabel: 'Start Application',
          fields: [
            {
              name: 'referrer',
              label: 'Referring member',
              type: 'text',
              required: false,
              placeholder: 'Jeff from work / school / neighborhood',
            },
            {
              name: 'notes',
              label: 'Any name-history notes',
              type: 'textarea',
              required: false,
              placeholder:
                'Former aliases, legal name changes, preferred spelling',
            },
          ],
        },
      ],
      interactive_requirement: {
        required: false,
        reason:
          'The landing page is informational and navigational; ordinary links and forms are sufficient for first contact.',
        behaviors: [],
      },
      renderer_scaffolding:
        'Server-owned scaffolding notes:\n\n- The local server injects hidden page-binding inputs into declared forms after validation.\n- The local server injects a small no-cache pageshow handler.\n- Keep the page self-contained and readable without external assets.\n- Give major interactive regions stable ids or data attributes so optional JavaScript has clear hooks.\n- Prefer semantic sections, obvious navigation blocks, and visible calls to action.\n',
    },
  },
  {
    name: 'moon_caves_home',
    seed: 'A luxury timeshare marketplace for moon caves, presented with absolute sincerity and endless upsells',
    renderPayload: {
      seed_phrase:
        'A luxury timeshare marketplace for moon caves, presented with absolute sincerity and endless upsells',
      path: '/',
      page_type: 'marketplace_home',
      page_summary:
        'The main landing page for a high-end moon cave timeshare marketplace, featuring featured cave estates, financing offers, ownership tiers, concierge services, and a prominent upsell path into inspections, memberships, and acquisition planning.',
      path_state_summary:
        'Visitor is at the root of the marketplace with no prior session state established.',
      title: 'Lunar Grotto Estates',
      design_brief:
        'Create a luxurious, impeccably branded homepage for a premium marketplace specializing in moon cave timeshares. The page should feel like an elite real-estate and hospitality destination, with polished editorial copy, rich sections for featured listings, ownership benefits, financing, concierge upgrades, and trust-building assurances about crater access, pressurized living zones, and orbital transfer schedules. Include a sense of abundance and constant premium upgrades: every section should invite the visitor to explore a better tier, a private viewing, a founding-member package, or a cave-side amenity bundle. The layout should have a grand hero area, a curated set of featured moon cave properties, a benefits/upsell ladder, testimonials from satisfied lunar owners, a news or journal strip, and a footer with navigation to maps, listings, auctions, ownership FAQ, and contact. Offer at least one search form for cave inventory and one inquiry or RSVP form for a private lunar presentation. Keep the experience sincere, aspirational, and lavish rather than comedic.',
      links: [
        {
          href: '/listings',
          label: 'Browse Cave Listings',
          description:
            'A curated catalog of current moon cave timeshare opportunities.',
        },
        {
          href: '/featured',
          label: 'Featured Estates',
          description:
            'Editor-selected premium grottoes and rare crater-adjacent holdings.',
        },
        {
          href: '/tours',
          label: 'Private Viewing Calendar',
          description:
            'Reserve an escorted virtual or in-person lunar inspection.',
        },
        {
          href: '/ownership',
          label: 'Ownership Tiers',
          description:
            'Compare seasonal, biannual, and legacy membership options.',
        },
        {
          href: '/financing',
          label: 'Moon Mortgage Desk',
          description: 'Review financing, escrow, and premium payment plans.',
        },
        {
          href: '/map',
          label: 'Crater Region Map',
          description:
            'Explore cave districts, lander access, and neighboring luxury domes.',
        },
        {
          href: '/auction',
          label: 'Auction House',
          description:
            'View premium releases, sealed bids, and rare inventory events.',
        },
        {
          href: '/faq',
          label: 'Ownership FAQ',
          description:
            'Learn about atmospheric sealing, transfer windows, and maintenance covenants.',
        },
        {
          href: '/concierge',
          label: 'Concierge Services',
          description:
            'Arrange luggage transfer, lunar dining, and arrival preparation.',
        },
        {
          href: '/journal',
          label: 'Estate Journal',
          description:
            'Read market notes, lunar lifestyle features, and owner spotlights.',
        },
        {
          href: '/contact',
          label: 'Contact an Advisor',
          description: 'Reach the acquisition team for bespoke guidance.',
        },
      ],
      forms: [
        {
          formId: 'inventory_search',
          method: 'GET',
          action: '/listings',
          purpose:
            'Search available moon cave timeshares by region, amenity, and ownership style.',
          submitLabel: 'Search Inventory',
          fields: [
            {
              name: 'q',
              label: 'Search',
              type: 'search',
              required: false,
              placeholder:
                'e.g. south rim grotto, skylight, low-traffic transfer',
            },
            {
              name: 'region',
              label: 'Region',
              type: 'text',
              required: false,
              placeholder: 'Mare Serenitatis, Aristarchus, etc.',
            },
            {
              name: 'tier',
              label: 'Ownership Tier',
              type: 'text',
              required: false,
              placeholder: 'Seasonal, Platinum, Legacy',
            },
            {
              name: 'max_rate',
              label: 'Maximum Annual Rate',
              type: 'number',
              required: false,
              placeholder: 'Annual dues ceiling',
            },
          ],
        },
        {
          formId: 'private_presentation',
          method: 'POST',
          action: '/tours/request',
          purpose:
            'Request a private lunar presentation, including concierge follow-up and a tailored upsell package.',
          submitLabel: 'Request Presentation',
          fields: [
            {
              name: 'name',
              label: 'Name',
              type: 'text',
              required: true,
              placeholder: 'Your full name',
            },
            {
              name: 'email',
              label: 'Email',
              type: 'email',
              required: true,
              placeholder: 'you@example.com',
            },
            {
              name: 'preferred_window',
              label: 'Preferred Viewing Window',
              type: 'text',
              required: false,
              placeholder: 'Weeknights, weekends, next transfer cycle',
            },
            {
              name: 'interests',
              label: 'Interests',
              type: 'textarea',
              required: false,
              placeholder:
                'Skylights, spa caves, low-gravity terraces, founder upgrades',
            },
          ],
        },
      ],
      interactive_requirement: {
        required: false,
        reason:
          'The homepage is primarily editorial and navigational; ordinary links and forms are sufficient without client-side manipulation.',
        behaviors: [],
      },
      renderer_scaffolding:
        'Server-owned scaffolding notes:\n\n- The local server injects hidden page-binding inputs into declared forms after validation.\n- The local server injects a small no-cache pageshow handler.\n- Keep the page self-contained and readable without external assets.\n- Give major interactive regions stable ids or data attributes so optional JavaScript has clear hooks.\n- Prefer semantic sections, obvious navigation blocks, and visible calls to action.\n',
    },
  },
];
