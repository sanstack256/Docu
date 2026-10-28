# DOCU — Product Specification & Implementation Contract

**Product:** Docu  
**Category:** Documentation website to offline PDF converter  
**Document type:** Product requirements, technical implementation constraints, security requirements, monetization strategy, and autonomous execution instructions  
**Status:** Initial product specification  
**Primary objective:** Build, test, deploy, and prepare a production-ready minimum viable product that converts supported public documentation websites into clean, navigable, searchable PDF manuals.

---

# 1. Product Vision

## 1.1 What is Docu?

Docu is a minimal web application that converts documentation websites into professionally formatted, downloadable PDF manuals.

A developer should be able to enter a documentation website URL, select the pages they want, generate a PDF, and download a coherent offline manual.

The output must preserve the meaning and structure of the source documentation. It must not be a crude concatenation of screenshots or unformatted webpages.

Docu exists to solve one specific problem:

**Documentation is spread across many webpages. Docu brings the selected documentation together into one usable offline document.**

## 1.2 Target users

The initial target audience consists of:

- Software developers who need offline access to technical documentation.
- Engineering teams that want a downloadable reference manual.
- Technical writers who need a portable documentation export.
- Developers working in environments with unreliable internet access.
- Users who need to archive publicly accessible documentation for legitimate purposes.

The first version is primarily intended for public technical documentation sites.

Do not expand the initial scope to general website archiving, arbitrary webpage conversion, private authenticated websites, or enterprise knowledge management.

## 1.3 Core user promise

A user provides a supported documentation URL and receives a readable PDF containing the selected documentation pages, with a table of contents, preserved technical content, page numbers, and useful navigation.

The promise is reliability, not an arbitrary number of features.

Docu must communicate limitations honestly. If certain pages cannot be captured, the product must identify them rather than claim that the manual is complete.

---

# 2. Non-Negotiable Product Principles

These principles govern every implementation decision.

## 2.1 No AI

Docu must not use AI or machine learning for any product functionality.

Specifically, do not implement:

- AI summaries.
- AI-generated documentation.
- AI-based content rewriting.
- AI chatbots.
- AI agents.
- AI-based page classification.
- LLM-powered crawling or extraction.
- AI-generated code explanations.
- AI-based document formatting.

Use deterministic software techniques: HTML parsing, DOM inspection, browser rendering, URL normalization, CSS rules, PDF generation, and explicit heuristics.

The product must work without an AI API key, model provider, or inference service.

## 2.2 Minimalism

Build only what is necessary to deliver the core promise reliably.

Do not introduce unnecessary dashboards, user profiles, analytics interfaces, team workspaces, template galleries, notifications, or unrelated PDF tools.

Every feature must justify its complexity by improving conversion quality, reliability, security, or monetization.

## 2.3 Correctness over completeness

A smaller number of correctly processed pages is better than a large export that silently omits content.

Never:

- Claim an export is complete when pages failed.
- Generate fake progress.
- Return a successful status for a failed job.
- Ignore rendering errors.
- Silently truncate content.
- Present unverified features as operational.
- Substitute placeholder content for missing pages.

All status indicators must reflect actual backend state.

## 2.4 No unnecessary rewrites

Inspect the existing repository before changing it.

If a project already exists, preserve working functionality, established conventions, and useful dependencies unless there is a clear technical reason to change them.

Do not assume file names, folder structure, deployment configuration, or package managers without inspecting the repository.

## 2.5 Human intervention only when required

The coding agent should perform all work that can safely be completed autonomously.

Ask for human intervention only when necessary, such as:

- Creating an account with an external provider.
- Completing identity or business verification.
- Supplying an API key or secret.
- Approving a paid service.
- Configuring a domain or DNS record requiring account access.
- Granting a required permission.
- Making a business decision that cannot be derived from this specification.

When intervention is needed, explain:

1. Why it is necessary.
2. Which provider or account is involved.
3. The exact action the user must take.
4. Where to perform that action.
5. What information or permission is required.
6. Which information must never be shared in chat.
7. What the agent will do after the user completes the step.

Never ask the user to reveal passwords, private keys, or sensitive credentials in the conversation.

Do not stop for permission to perform ordinary coding, testing, refactoring, or configuration tasks that are already authorized and safe.

---

# 3. Core User Journey

The initial application must support the following complete workflow.

1. A user opens the Docu website.
2. The user enters the URL of a public documentation website.
3. Docu validates the URL and checks whether the target can be processed safely.
4. Docu discovers the available documentation pages.
5. The user reviews the discovered pages and selects which pages to include.
6. Docu processes the selected pages.
7. Docu creates a PDF with consistent formatting and navigation.
8. Docu reports the actual result, including any failed or omitted pages.
9. The user downloads the generated PDF.

The experience must be straightforward enough that a first-time visitor can use it without reading a tutorial.

Do not require an account merely to try the basic conversion flow unless a demonstrated technical or abuse-prevention requirement makes anonymous use impractical.

---

# 4. Functional Requirements

## 4.1 URL input and validation

The home page must provide a single prominent URL input.

Requirements:

- Accept HTTP and HTTPS URLs only.
- Reject malformed URLs with a clear error.
- Reject unsupported URL schemes.
- Normalize URLs consistently.
- Identify the site's origin and permitted crawl scope.
- Reject URLs that resolve to prohibited internal or private network addresses.
- Validate redirect destinations.
- Provide an understandable message when the website cannot be processed.
- Avoid starting a crawl until validation succeeds.

The interface must not claim that every website is supported.

## 4.2 Documentation page discovery

Docu must discover pages belonging to the selected documentation site.

Use deterministic methods:

1. Inspect sitemap files where available.
2. Extract links from accessible pages.
3. Use documentation navigation and internal links.
4. Use a controlled browser-rendering fallback for supported JavaScript-driven sites.

The discovery process must:

- Stay within the permitted site and path scope.
- Avoid crawling unrelated external websites.
- Normalize URLs and remove fragments for page deduplication.
- Handle query parameters conservatively.
- Detect duplicate pages and redirect aliases.
- Avoid infinite navigation loops.
- Respect applicable access restrictions and crawling policies.
- Enforce page-count, depth, time, and resource limits.
- Produce a stable list of discovered pages.

Do not assume that every link on a documentation site is a documentation page.

Where possible, prioritize the documentation navigation hierarchy rather than indiscriminately crawling every linked resource.

### Discovery results

Display:

- Page title.
- Page URL.
- Parent or section where known.
- Selection checkbox.
- Total discovered page count.
- Any discovery warnings.

The user must be able to select or deselect individual pages and use a select-all control.

If discovery returns no usable pages, explain why and offer an appropriate next step.

## 4.3 Content extraction

Extract the meaningful content from each selected page.

Supported content must include:

- Page title.
- Headings and subheadings.
- Paragraphs.
- Ordered and unordered lists.
- Inline code.
- Code blocks.
- Tables.
- Links.
- Images that can be retrieved safely.
- Common documentation callouts, warnings, notes, and tips.
- Supported diagrams and static illustrations.

Remove repeated website elements where their purpose can be identified reliably:

- Navigation bars.
- Repeated sidebars.
- Footers.
- Cookie banners.
- Unrelated promotional elements.
- Other clearly non-content interface components.

Do not remove meaningful content merely because it appears inside a visually unusual element.

Prefer semantic HTML and identifiable content containers over fragile, site-specific CSS selectors.

Provide deterministic fallback strategies when a primary content container cannot be identified.

Do not silently discard content when extraction confidence is insufficient. Record warnings and make the affected page available for inspection or exclusion.

### Dynamic content

Use a browser-rendering engine for supported sites where JavaScript is necessary to display the actual documentation.

Set bounded navigation and rendering timeouts.

Do not wait indefinitely for network activity to stop. Modern documentation websites may maintain persistent connections or load nonessential resources continuously.

Use a defined readiness strategy, such as DOM readiness followed by bounded checks for the main content.

If the page still cannot be rendered correctly, mark it as failed or partially processed.

## 4.4 PDF generation

The PDF generator is the central component of Docu. Its output quality must be tested rather than assumed.

Every generated PDF should include, where applicable:

- A clean title page.
- The documentation site title.
- Source URL.
- Generation date.
- A clickable table of contents.
- Correct heading hierarchy.
- Consistent typography.
- Page numbers.
- Readable paragraphs and lists.
- Readable code blocks in a monospace font.
- Tables that fit the available page width or use appropriate layout adjustments.
- Images scaled proportionally.
- Clickable hyperlinks where supported.
- Searchable text.
- PDF document metadata.

### Code formatting

Technical documentation often contains long commands, JSON, configuration files, and code samples.

The PDF renderer must:

- Preserve whitespace where meaningful.
- Preserve indentation.
- Use a monospace font for code.
- Avoid clipping long lines.
- Use wrapping or an appropriate alternative for long code.
- Avoid breaking code blocks in ways that make examples unusable.
- Maintain readable contrast in code styling.

Do not attempt to make every code sample fit by shrinking text to an unreadable size.

### Tables and images

- Prevent table content from being silently clipped.
- Repeat table headers across pages when supported.
- Scale images proportionally.
- Avoid stretching diagrams.
- Provide reasonable page breaks around large elements.
- Record inaccessible or unsupported resources.

### Links and navigation

The table of contents must navigate to the appropriate sections where the chosen PDF-generation library supports this.

Internal links should point to the corresponding generated destinations where feasible.

External hyperlinks should retain their source destinations.

The generated PDF should not rely on the original website remaining available to preserve its actual text content.

### Completeness reporting

Every export must maintain a processing report containing:

- Pages selected.
- Pages successfully processed.
- Pages partially processed.
- Pages failed.
- Pages skipped intentionally.
- Resource or rendering warnings.
- Final PDF generation status.

A partial manual must be labeled as partial.

A successful download must refer to an actual generated file.

---

# 5. Processing and Job Management

Crawling and rendering documentation sites can take longer than a typical web request. Do not implement the entire conversion as one unbounded request.

Use a job-based architecture.

## 5.1 Job lifecycle

A conversion job should have explicit states:

- `queued`
- `discovering`
- `awaiting_selection` (if selection is a separate stage)
- `processing`
- `generating_pdf`
- `completed`
- `completed_with_warnings`
- `failed`
- `cancelled` (only if cancellation is implemented)

Persist the state needed to recover from temporary failures.

The interface must display the actual job state, not a simulated progress percentage.

## 5.2 Progress reporting

Show meaningful progress based on real events, such as:

- Pages discovered.
- Pages processed.
- Pages remaining.
- PDF generation started.
- Finalization completed.

If exact percentage progress is unavailable, display a status message and actual counts instead of inventing a percentage.

## 5.3 Error handling

Handle:

- DNS failures.
- Connection timeouts.
- HTTP errors.
- Redirect loops.
- Unsupported page types.
- Rendering timeouts.
- Resource-loading failures.
- PDF generation failures.
- Storage failures.
- Worker restarts.
- Rate limits.
- Site restrictions.

Use bounded retries with appropriate backoff for transient failures.

Do not retry permanent errors indefinitely.

Users should receive actionable explanations without being exposed to sensitive infrastructure details.

## 5.4 File lifecycle

Generated files must be stored temporarily.

Implement:

- Unique job identifiers.
- Unique file names.
- Access checks before download.
- Defined expiration times.
- Automatic deletion of expired files.
- Cleanup after failed or abandoned jobs.
- Protection against one user accessing another user's files.

If anonymous jobs are supported, use unguessable download tokens and suitable rate limits. Do not treat a publicly visible sequential job ID as authorization.

---

# 6. Security and Abuse Prevention

Security is a launch requirement, not a later enhancement.

## 6.1 Server-side request forgery (SSRF)

Because users can supply URLs, the application must prevent requests to internal services.

At minimum:

- Block localhost.
- Block private IPv4 and IPv6 ranges.
- Block link-local addresses.
- Block cloud metadata endpoints.
- Reject non-HTTP(S) schemes.
- Validate DNS resolutions.
- Validate the destination of every redirect.
- Prevent DNS rebinding from bypassing address checks.
- Ensure browser subrequests and resource fetches are subject to appropriate network restrictions.
- Restrict outbound network access at the infrastructure level where feasible.

URL validation alone is not sufficient.

Do not permit submitted pages to make arbitrary requests to the application's internal network.

## 6.2 Resource limits

Apply explicit limits for:

- Maximum pages per job.
- Maximum crawl depth.
- Maximum execution duration.
- Maximum page size.
- Maximum total downloaded data.
- Maximum image dimensions or processing cost.
- Maximum browser concurrency.
- Maximum queued jobs per visitor or account.
- Maximum generated PDF size.

Choose initial limits based on actual infrastructure capacity, then make them configurable.

Do not allow a single conversion to exhaust the worker's memory or CPU.

## 6.3 Data protection

- Never log secrets.
- Do not expose stack traces to end users.
- Avoid retaining source content unnecessarily.
- Delete temporary files according to the retention policy.
- Use HTTPS in production.
- Keep credentials in the deployment platform's secret store.
- Do not commit secrets to the repository.
- Do not store unnecessary personal information.
- Document what data is collected and retained.

## 6.4 Legal and access boundaries

Docu must process only content the user is authorized to access.

It must not bypass authentication, paywalls, access controls, or anti-abuse protections.

Respect applicable site policies, copyright requirements, and restrictions on redistribution.

The application must make clear that generating a PDF does not grant permission to republish the underlying content.

---

# 7. User Interface and Design

## 7.1 Design direction

Build a restrained, professional interface.

The product should feel like a polished utility, not an enterprise administration platform.

Priorities:

1. Clarity.
2. Readability.
3. Speed.
4. Accessibility.
5. Responsive behavior.
6. Clear processing and error states.

Avoid:

- Excessive gradients.
- Decorative animation without a functional purpose.
- Artificial progress animations.
- Unnecessary cards and panels.
- Multiple competing calls to action.
- Oversized hero sections that obscure the tool.
- Fake testimonials.
- Fake usage statistics.
- Fake customer logos.
- Fake product capabilities.

## 7.2 Required screens

### Home

- Docu logo or wordmark.
- Short explanation.
- URL input.
- Primary conversion action.
- Concise free-plan limits.
- Brief privacy and support information.
- Pricing link.

### Page selection

- Discovered page hierarchy.
- Page titles and URLs.
- Select-all and individual selection.
- Selected-page count.
- Continue action.
- Discovery warnings.

### Processing

- Actual status.
- Real progress information.
- Processed and remaining page counts.
- Useful failure messages.
- Cancellation only if correctly implemented.

### Result

- Download action.
- Export summary.
- Warning or partial-completion report.
- Retry option for recoverable failures.

### Pricing

- Free and Pro plan comparison.
- Transparent usage limits.
- Billing interval and price.
- Clear upgrade and cancellation terms.
- No fabricated discounts or urgency.

### Legal pages

Provide a privacy policy and terms of service suitable for the actual product behavior. Do not generate unsupported legal promises.

## 7.3 Accessibility

- All core actions must be keyboard accessible.
- Inputs must have accessible labels.
- Focus states must be visible.
- Error messages must be associated with the relevant control.
- Color must not be the only indicator of status.
- Layout must remain usable on mobile devices.

---

# 8. Monetization

Docu will use a proposed freemium model.

The Free plan provides a meaningful trial. Pro is for users who need more capacity and control.

All prices and limits below are initial business hypotheses, not established market facts. Validate them against actual infrastructure costs and customer feedback before finalizing them.

## 8.1 Free plan

Proposed limits:

- Two exports per month.
- Maximum 20 selected pages per export.
- Standard PDF formatting.
- Page selection.
- Table of contents.
- Searchable text.
- Standard download.
- No account required where anonymous usage can be enforced safely.

The Free plan must produce a genuinely usable PDF.

Do not deliberately degrade the output quality to force upgrades.

## 8.2 Pro plan

Proposed launch price: **$12 per month**.

Proposed limits and benefits:

- Up to 500 selected pages per export.
- Up to 20 exports per month.
- All Free features.
- Custom document title and metadata.
- Higher processing limits.
- Priority in the job queue within defined limits.

Only implement features that are functional and tested.

Do not advertise guaranteed priority processing unless the queue actually implements it.

Do not advertise private-site support, scheduled exports, or team features in the initial version.

## 8.3 Billing requirements

If Pro is implemented:

- Use a payment provider that supports the operator's jurisdiction and business model.
- Verify current provider availability, onboarding, fees, and settlement requirements before selecting it.
- Implement server-verified payment status.
- Use signed webhook verification.
- Make subscription status authoritative on the server.
- Enforce plan limits on the server, not only in the interface.
- Handle subscription creation, renewal, cancellation, and failed payments.
- Handle webhook retries and duplicate events safely.
- Provide a clear route to manage or cancel a subscription.
- Never expose secret payment credentials to the browser.
- Test the payment flow in sandbox mode before production.
- Do not claim payment integration is complete until the full flow is verified.

If provider account creation or verification is required, ask the user for the specific intervention.

## 8.4 Revenue objective

The initial target is $200 in gross revenue as soon as practical.

At $12 per month, 17 active subscribers produce $204 in monthly recurring revenue before fees, taxes, refunds, and expenses.

This is a calculation, not a prediction.

Do not assume organic search traffic will arrive immediately. The product must be marketed directly to potential users while demand is being validated.

## 8.5 Alternative payment hypothesis

A one-time payment for a large export may be worth testing later.

Do not implement a second billing model until there is evidence that customers want it.

Keep the initial monetization model simple: Free and Pro.

---

# 9. Technical Architecture

Inspect the repository before choosing or changing the stack.

If starting from an empty repository, use a practical architecture that supports browser rendering, reliable background jobs, and secure PDF generation.

A reasonable starting direction is:

- Next.js and TypeScript for the website and application API.
- A dedicated worker process for crawling and browser rendering.
- A browser automation framework for supported JavaScript-driven sites.
- A deterministic HTML extraction layer.
- A reliable HTML-to-PDF rendering library.
- A persistent job store.
- Temporary object storage if required by the deployment architecture.
- A payment provider only when the Free product is stable.

Do not introduce infrastructure solely because it is fashionable.

Choose dependencies based on maintenance, license, compatibility, security, deployment constraints, and output quality.

## 9.1 Worker architecture

The crawling and PDF-generation process must not depend on a single long-running web request.

Use a worker with:

- Bounded concurrency.
- Job timeouts.
- Resource limits.
- Retry policy.
- Job-state persistence.
- Cleanup.
- Graceful shutdown.
- Structured logging.

Use a queue or equivalent durable job mechanism when required by the deployment environment.

## 9.2 Deployment

Before choosing hosting:

- Verify that the environment supports browser automation if required.
- Verify available memory, execution limits, and temporary disk capacity.
- Verify worker runtime and deployment constraints.
- Estimate costs for typical and worst-case exports.
- Avoid designs that rely on unsupported long-running serverless execution.
- Ensure the worker and frontend can communicate securely.

Do not deploy the entire crawling workload into a short-lived request handler simply because the frontend uses serverless hosting.

## 9.3 Configuration

Use environment variables for environment-specific configuration.

Provide a documented example environment file containing placeholders only.

Document:

- Required variables.
- Optional variables.
- Their purpose.
- Which service supplies them.
- Whether a restart or redeployment is required after changing them.

Never include real secrets in the example file.

---

# 10. Testing and Acceptance Criteria

Testing must verify the actual output and behavior.

## 10.1 Functional tests

Test:

- URL validation.
- URL normalization.
- Page discovery.
- Duplicate detection.
- Page selection.
- Content extraction.
- Job-state transitions.
- PDF generation.
- Download authorization.
- File expiration.
- Retry behavior.
- Free-plan limits.
- Pro-plan limits if implemented.

## 10.2 PDF quality tests

Create a deterministic test corpus containing representative HTML pages with:

- Nested headings.
- Long paragraphs.
- Ordered and unordered lists.
- Inline code.
- Long code blocks.
- JSON examples.
- Wide tables.
- Images.
- Internal and external links.
- Callouts.
- Very long pages.
- Missing images.
- Pages that fail to load.

Inspect generated PDFs programmatically and visually where practical.

Verify that:

- The PDF opens successfully.
- Text can be selected and searched.
- The table of contents points to the correct sections.
- Page numbers are present.
- Code is readable.
- Tables are not silently truncated.
- Images preserve aspect ratios.
- Links work where supported.
- Failed pages are reported.
- Partial exports are labeled accurately.

A successful HTTP response from a PDF library does not establish that the output is good.

## 10.3 Security tests

Test:

- Localhost targets.
- Private IP addresses.
- IPv6 local addresses.
- Redirects to prohibited destinations.
- DNS resolution changes where the test environment permits.
- URLs with unusual encodings.
- Oversized pages.
- Deep or cyclic links.
- Excessive concurrency.
- Unauthorized downloads.
- Expired download tokens.
- Cross-job data access.
- Abuse of anonymous quotas.

Use controlled test targets rather than attempting to access real internal infrastructure.

## 10.4 End-to-end acceptance

The product is not ready to launch until a user can:

1. Open the deployed application.
2. Enter a supported public documentation URL.
3. Discover and select pages.
4. Generate a PDF.
5. Download the actual file.
6. Verify that the PDF contains the expected content.
7. Receive an accurate report if any pages failed.

If Pro is launched, the complete payment-to-entitlement flow must also be tested.

---

# 11. Observability and Operational Reliability

Implement sufficient logging to diagnose real failures without creating an unnecessary monitoring dashboard.

Logs should include:

- Job ID.
- Job state transitions.
- Number of pages discovered.
- Number of pages processed.
- Number of failed pages.
- Processing duration.
- PDF generation duration.
- Failure category.
- Cleanup outcome.

Avoid logging page contents, secrets, or unnecessary personal data.

Make errors actionable for the operator while keeping user-facing messages safe and concise.

---

# 12. Explicitly Out of Scope

Do not implement these features in the initial release:

- AI of any kind.
- Chatbots.
- AI-generated summaries.
- AI-based extraction.
- General-purpose PDF merging or editing.
- PDF-to-Word conversion.
- PDF signing.
- OCR as a separate product feature.
- Website screenshot archiving.
- Website monitoring and change notifications.
- Scheduled recurring exports.
- Team workspaces.
- Collaboration features.
- Enterprise administration.
- Private authenticated website crawling.
- Browser extensions.
- Mobile applications.
- Public API plans.
- Custom template marketplace.
- Complex account dashboards.
- Unrelated productivity features.

Do not add features merely because competitors have them.

Reconsider out-of-scope features only when actual user feedback or business evidence justifies them.

---

# 13. Autonomous Coding Agent Operating Contract

The agent must work as an implementation engineer, not merely provide advice or generate a large amount of code without verification.

## 13.1 Repository inspection

Before modifying anything:

1. Inspect the current repository.
2. Identify the framework and package manager.
3. Inspect existing scripts, dependencies, environment files, and deployment configuration.
4. Identify existing tests and working functionality.
5. Report any material architectural constraints.
6. Preserve existing working systems unless a justified change is necessary.

Do not assume the project is empty.

Do not replace configuration files without understanding their current purpose.

## 13.2 Execution

The agent should implement the product end to end, including:

- Frontend.
- Backend.
- Crawler.
- Extraction pipeline.
- PDF renderer.
- Background processing.
- Security controls.
- Usage limits.
- Error handling.
- Automated tests.
- Documentation.
- Deployment configuration.

It should use the available tools to inspect, edit, execute, and verify the actual project.

Do not merely produce suggested code snippets when direct repository work is possible.

## 13.3 Work management

Maintain a concise internal checklist of completed, pending, blocked, and failed requirements.

Work in logical increments that preserve a working repository.

Do not require the user to approve every small implementation decision.

When a requirement is ambiguous, prefer the simplest secure interpretation consistent with this specification. Ask only when the decision materially affects the product or cannot be safely inferred.

## 13.4 Human intervention protocol

Whenever human intervention is required, emit a clearly labeled message:

**HUMAN INTERVENTION REQUIRED**

Include:

- The exact blocker.
- Why it cannot be completed autonomously.
- The provider or service involved.
- The precise action required from the user.
- The required permission or non-secret configuration information.
- A warning not to share passwords or private credentials in chat.
- The next action the agent will perform after the user responds.

Continue all independent work that is safe to perform while waiting.

Never pretend that an account, secret, DNS record, payment provider, or deployment was configured when it was not.

## 13.5 No fake verification

The agent must distinguish among:

- Implemented.
- Unit tested.
- Integration tested.
- End-to-end tested.
- Deployed.
- Production verified.

These are different states.

A feature is not production verified merely because the code compiles.

Do not fabricate test output, successful commands, deployment URLs, environment values, or external service responses.

## 13.6 Completion report

At the end of implementation, provide:

1. What was built.
2. The actual architecture.
3. Important files and modules.
4. Tests executed and their results.
5. Security controls implemented.
6. Known limitations.
7. Deployment status.
8. Required accounts, secrets, or user actions.
9. Actual production URL if deployment succeeded.
10. Remaining work before accepting payments.

Do not mark the project complete if critical acceptance criteria remain unverified.

---

# 14. Definition of Done

Docu's initial release is complete only when all applicable criteria are met:

- [ ] The application has a minimal, usable interface.
- [ ] A supported public documentation site can be discovered.
- [ ] Users can select individual pages.
- [ ] Content extraction preserves important technical material.
- [ ] PDF output is readable, searchable, and navigable.
- [ ] Long code blocks and tables are handled safely.
- [ ] Failed pages are reported accurately.
- [ ] The job lifecycle is reliable.
- [ ] Resource limits are enforced.
- [ ] SSRF protections are implemented and tested.
- [ ] Temporary files have a defined retention policy.
- [ ] Download authorization is enforced.
- [ ] Free usage limits are enforced server-side.
- [ ] Tests cover the critical workflow.
- [ ] The deployed application has been tested end to end.
- [ ] Privacy and terms pages reflect actual behavior.
- [ ] The agent has reported any remaining human intervention.
- [ ] No AI functionality is present.
- [ ] No unrelated features have been added.

Payment integration may be completed after the core conversion workflow is stable, but Pro must not be advertised as purchasable until billing and entitlement enforcement are verified.

---

# 15. Final Direction

Build Docu as a small, dependable utility with a clear purpose.

Do not optimize for the largest possible feature list.

Optimize for:

1. Correct page discovery.
2. Faithful content extraction.
3. Excellent PDF readability.
4. Reliable background processing.
5. Accurate failure reporting.
6. Strong URL-fetching security.
7. Simple user experience.
8. Sustainable operating costs.
9. A credible path to paid usage.

The initial product must do one job exceptionally well: turn supported public documentation websites into useful offline PDF manuals.

**Begin by inspecting the repository. Then implement, test, and verify the product against this specification. Request human intervention only when a genuine external action, permission, credential, or business decision requires it.**

